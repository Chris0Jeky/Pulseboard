"""Real-browser proof that a queued SDK event survives navigation via fetch keepalive.

Compare Playwright interception with two actual loopback HTTPS origins, with both
cold and cached CORS preflights. No production endpoint or stored telemetry is touched.
"""

import argparse
import asyncio
from collections import deque
import json
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import Route, async_playwright, expect

from keepalive_http import HttpsFixture, safe_url

ROOT = Path(__file__).resolve().parents[1]
SOURCE_ORIGIN = "https://mdviewer-c9r.pages.dev"
COLLECTOR_ORIGIN = "https://collector.example"
COLLECTOR_ENDPOINT = f"{COLLECTOR_ORIGIN}/v1/collect/mdviewer"


NETWORK_TRACE = deque(maxlen=64)


def generated_sdk(source_origin=SOURCE_ORIGIN, endpoint=COLLECTOR_ENDPOINT) -> str:
    source = """
import { buildEmbed } from './adapters/build-embed.mjs';
import { projects } from './src/projects.mjs';
// Test-only in-memory origin; never write or relax the production registry.
const [origin, endpoint] = process.argv.slice(1);
projects.mdviewer.origin = origin;
process.stdout.write(buildEmbed('mdviewer', {
  endpoint,
  clicks: [{ selector: '#leave', event: 'export.print_requested' }],
}));
"""
    return subprocess.check_output(
        ["node", "--input-type=module", "-e", source, source_origin, endpoint],
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


async def exercise(transport, chromium=None, fixture=None) -> None:
    source_origin = fixture.source_origin if fixture else SOURCE_ORIGIN
    collector_origin = fixture.collector_origin if fixture else COLLECTOR_ORIGIN
    endpoint = collector_origin + '/v1/collect/mdviewer'
    script = generated_sdk(source_origin, endpoint)
    if fixture:
        fixture.script = script
    receipts = fixture.receipts if fixture else deque(maxlen=64)
    NETWORK_TRACE.clear()

    def trace(kind, request):
        NETWORK_TRACE.append({
            'kind': kind, 'method': request.method,
            'url': safe_url(request.url),
            'resourceType': request.resource_type,
            **({'failure': str(request.failure)[:160]} if kind == 'failed' else {}),
        })
    page_errors: list[str] = []
    console_messages: list[dict] = []
    requests: list[dict] = []

    async with async_playwright() as playwright:
        # The production SDK deliberately stays inert when navigator.webdriver is true.
        # Disable Blink's automation exposure only for this fixture so it reaches the
        # real visitor navigation/keepalive path rather than testing the webdriver gate.
        browser = await playwright.chromium.launch(
            headless=True,
            **({"executable_path": chromium} if chromium else {}),
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            context = await browser.new_context(ignore_https_errors=fixture is not None)
            context.on("request", lambda request: trace("request", request))
            context.on("requestfinished", lambda request: trace("finished", request))
            context.on("requestfailed", lambda request: trace("failed", request))
            await context.add_cookies(
                [
                    {
                        "name": "collector_secret",
                        "value": "must-not-leave",
                        "url": collector_origin,
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
                    "Access-Control-Allow-Origin": source_origin,
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

            if fixture is None:
                await context.route(f"{source_origin}/**", source)
                await context.route(f"{collector_origin}/**", collector)

            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("console", lambda message: console_messages.append({"type": message.type, "text": message.text}))
            page.on("request", lambda request: requests.append({"url": request.url, "resourceType": request.resource_type}))
            await page.goto(f"{source_origin}/", wait_until="load")
            await page.wait_for_timeout(250)
            diagnostics = await page.evaluate(
                """() => ({
                  location: { origin: location.origin, protocol: location.protocol, pathname: location.pathname },
                  readyState: document.readyState,
                  webdriver: navigator.webdriver,
                  doNotTrack: navigator.doNotTrack,
                  globalPrivacyControl: navigator.globalPrivacyControl ?? null,
                  scripts: [...document.scripts].map(script => ({ src: script.src, type: script.type })),
                  pulseboardUsageType: typeof globalThis.PulseboardUsage,
                  pulseboardUsageIsNull: globalThis.PulseboardUsage === null,
                  bodyText: document.body?.innerText || '',
                })"""
            )
            diagnostics.update({"pageErrors": page_errors, "console": console_messages, "requests": requests})
            assert diagnostics["webdriver"] is False, diagnostics
            sharing_panel = page.locator("#pulseboard-usage-sharing")
            if await sharing_panel.count() == 0:
                print(json.dumps({"mountDiagnostics": diagnostics}, indent=2))
                raise AssertionError("generated SDK did not mount its consent control")
            await expect(sharing_panel).to_be_visible()
            await sharing_panel.locator("summary").click()
            sharing = sharing_panel.locator("input[type=checkbox]")
            await expect(sharing).to_be_visible()
            await sharing.check()
            await wait_for_event(receipts, "page.view")
            # Separate the queued-pagehide case from reissuing an unfinished initial batch.
            await page.wait_for_function("globalThis.PulseboardUsage.status().sent === 1", timeout=5000)

            receipts.clear()
            await page.locator("#leave").click()
            await expect(page.locator("#arrived")).to_be_visible()
            receipt = await wait_for_event(receipts, "export.print_requested")
            payload = receipt["body"].encode("utf-8")
            submitted = json.loads(receipt["body"])["events"]

            assert len(payload) <= 64 * 1024, len(payload)
            assert [event["event"] for event in submitted] == ["export.print_requested"]
            assert receipt["url"] == endpoint
            assert receipt["headers"].get("origin") == source_origin
            assert "cookie" not in receipt["headers"], receipt["headers"]
            assert "referer" not in receipt["headers"], receipt["headers"]
            assert not page_errors, page_errors
            preflights = None
            if fixture:
                preflights = sum(item['method'] == 'OPTIONS' for item in fixture.trace)
                # A cache-free collector needs a fresh preflight on the pagehide POST;
                # a warmed cache reuses the initial admission preflight.
                assert preflights == (2 if fixture.max_age == 0 else 1), list(fixture.trace)

            print(
                json.dumps(
                    {
                        "passed": True,
                        "transport": transport,
                        "actualSocketPreflights": preflights,
                        "networkTrace": list(NETWORK_TRACE),
                        "navigation": page.url,
                        "delivered": [event["event"] for event in submitted],
                        "bytes": len(payload),
                        "cookiesSent": False,
                        "referrerSent": False,
                    },
                    indent=2,
                )
            )
        finally:
            await browser.close()


async def run(args):
    transports = ['intercepted', 'http-cold', 'http-cached'] if args.transport == 'all' else [args.transport]
    for transport in transports:
        try:
            if transport == 'intercepted':
                await exercise(transport, args.chromium)
            else:
                with HttpsFixture(max_age=0 if transport == 'http-cold' else 600) as fixture:
                    try:
                        await exercise(transport, args.chromium, fixture)
                    except BaseException:
                        print(json.dumps({'collectorTrace': list(fixture.trace)}, indent=2))
                        raise
        except BaseException:
            print(json.dumps({'transport': transport, 'networkTrace': list(NETWORK_TRACE)}, indent=2))
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transport', choices=['all', 'intercepted', 'http-cold', 'http-cached'], default='all')
    parser.add_argument('--chromium', help='Optional existing Chromium executable for local testing')
    asyncio.run(run(parser.parse_args()))
