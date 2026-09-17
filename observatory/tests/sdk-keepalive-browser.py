"""Real-browser proof that a queued SDK event survives navigation via fetch keepalive.

The registered MDviewer HTTPS origin and a collector origin are fulfilled entirely by
Playwright routes. No production endpoint, deployment, or stored telemetry is touched.
"""

import asyncio
import json
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import Route, async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ORIGIN = "https://mdviewer-c9r.pages.dev"
COLLECTOR_ORIGIN = "https://collector.example"
COLLECTOR_ENDPOINT = f"{COLLECTOR_ORIGIN}/v1/collect/mdviewer"


def generated_sdk() -> str:
    source = """
import { buildEmbed } from './adapters/build-embed.mjs';
process.stdout.write(buildEmbed('mdviewer', {
  endpoint: 'https://collector.example/v1/collect/mdviewer',
  clicks: [{ selector: '#leave', event: 'export.print_requested' }],
}));
"""
    return subprocess.check_output(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        text=True,
    )


def events(receipts: list[dict]) -> list[dict]:
    result = []
    for receipt in receipts:
        result.extend(json.loads(receipt["body"])["events"])
    return result


async def wait_for_event(receipts: list[dict], name: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for receipt in receipts:
            for event in json.loads(receipt["body"])["events"]:
                if event["event"] == name:
                    return receipt
        await asyncio.sleep(0.05)
    raise AssertionError(f"timed out waiting for {name}; received {events(receipts)}")


async def run() -> None:
    script = generated_sdk()
    receipts: list[dict] = []
    page_errors: list[str] = []

    async with async_playwright() as playwright:
        # The production SDK deliberately stays inert when navigator.webdriver is true.
        # Disable Blink's automation exposure only for this fixture so it reaches the
        # real visitor navigation/keepalive path rather than testing the webdriver gate.
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context()
        await context.add_cookies(
            [
                {
                    "name": "collector_secret",
                    "value": "must-not-leave",
                    "url": COLLECTOR_ORIGIN,
                    "sameSite": "None",
                    "secure": True,
                }
            ]
        )

        async def source(route: Route) -> None:
            path = urlparse(route.request.url).path
            if path == "/observer.js":
                await route.fulfill(
                    status=200,
                    headers={"Content-Type": "application/javascript; charset=utf-8"},
                    body=script,
                )
                return
            if path == "/next":
                await route.fulfill(
                    status=200,
                    headers={"Content-Type": "text/html; charset=utf-8"},
                    body="<!doctype html><html><body><main id='arrived'>Arrived</main></body></html>",
                )
                return
            await route.fulfill(
                status=200,
                headers={"Content-Type": "text/html; charset=utf-8"},
                body=(
                    "<!doctype html><html><body>"
                    "<a id='leave' href='/next'>Leave this page</a>"
                    "<script src='/observer.js'></script>"
                    "</body></html>"
                ),
            )

        async def collector(route: Route) -> None:
            headers = {
                "Access-Control-Allow-Origin": SOURCE_ORIGIN,
                "Vary": "Origin",
            }
            request = route.request
            if request.method == "OPTIONS":
                await route.fulfill(
                    status=204,
                    headers={
                        **headers,
                        "Access-Control-Allow-Methods": "POST",
                        "Access-Control-Allow-Headers": "Content-Type",
                        "Access-Control-Max-Age": "600",
                    },
                )
                return
            assert request.method == "POST"
            receipts.append(
                {
                    "body": request.post_data or "",
                    "headers": request.headers,
                    "url": request.url,
                }
            )
            await route.fulfill(
                status=202,
                headers={**headers, "Content-Type": "application/json"},
                body="{}",
            )

        await context.route(f"{SOURCE_ORIGIN}/**", source)
        await context.route(f"{COLLECTOR_ORIGIN}/**", collector)

        page = await context.new_page()
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        await page.goto(f"{SOURCE_ORIGIN}/", wait_until="load")
        assert await page.evaluate("navigator.webdriver") is False
        sharing = page.locator("#pulseboard-usage-sharing input[type=checkbox]")
        await expect(sharing).to_be_visible()
        await sharing.check()
        await wait_for_event(receipts, "page.view")

        receipts.clear()
        await page.locator("#leave").click()
        await expect(page.locator("#arrived")).to_be_visible()
        receipt = await wait_for_event(receipts, "export.print_requested")
        payload = receipt["body"].encode("utf-8")
        submitted = json.loads(receipt["body"])["events"]

        assert len(payload) <= 64 * 1024, len(payload)
        assert [event["event"] for event in submitted] == ["export.print_requested"]
        assert receipt["url"] == COLLECTOR_ENDPOINT
        assert receipt["headers"].get("origin") == SOURCE_ORIGIN
        assert "cookie" not in receipt["headers"], receipt["headers"]
        assert "referer" not in receipt["headers"], receipt["headers"]
        assert not page_errors, page_errors

        print(
            json.dumps(
                {
                    "passed": True,
                    "navigation": page.url,
                    "delivered": [event["event"] for event in submitted],
                    "bytes": len(payload),
                    "cookiesSent": False,
                    "referrerSent": False,
                },
                indent=2,
            )
        )
        await browser.close()


if __name__ == "__main__":
    asyncio.run(run())
