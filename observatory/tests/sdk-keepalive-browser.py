"""Real-browser proof that a queued SDK event survives navigation via fetch keepalive.

Use two actual loopback HTTPS origins, with both max-age 0 and 600. A separate
control tests default-vs-no-store cache behavior. No production endpoint or stored telemetry is touched.
"""

import argparse
import asyncio
from collections import deque
import json
import subprocess
import threading
import time
from pathlib import Path

from playwright.async_api import async_playwright, expect

from keepalive_http import HttpsFixture, safe_url

ROOT = Path(__file__).resolve().parents[1]
NETWORK_TRACE = deque(maxlen=64)


def generated_sdk(source_origin, endpoint) -> str:
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


def trust(fixture) -> str:
    # Not ignore_https_errors: that override applies after Chromium rejects the
    # handshake, and Chromium 151 drops the unload keepalive request at that
    # rejection (a TLS alert, then nothing). Trust the fixture key at handshake time.
    return f"--ignore-certificate-errors-spki-list={fixture.spki}"


def events(receipts: list[dict]) -> list[dict]:
    result = []
    for receipt in list(receipts):
        result.extend(json.loads(receipt["body"])["events"])
    return result


async def wait_for_event(receipts: list[dict], name: str, timeout: float = 5.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for receipt in list(receipts):
            for event in json.loads(receipt["body"])["events"]:
                if event["event"] == name:
                    return receipt
        await asyncio.sleep(0.05)
    raise AssertionError(f"timed out waiting for {name}; received {events(receipts)}")


async def exercise(transport, fixture, chromium=None) -> None:
    source_origin = fixture.source_origin
    collector_origin = fixture.collector_origin
    endpoint = collector_origin + '/v1/collect/mdviewer'
    script = generated_sdk(source_origin, endpoint)
    fixture.script = script
    receipts = fixture.receipts
    NETWORK_TRACE.clear()

    def trace(kind, request):
        NETWORK_TRACE.append({
            'kind': kind, 'method': request.method,
            'url': safe_url(request.url),
            'resourceType': request.resource_type,
            **({'failure': str(request.failure)[:160]} if kind == 'failed' else {}),
        })
    page_errors = deque(maxlen=64)
    console_messages = deque(maxlen=64)
    requests = deque(maxlen=64)

    async with async_playwright() as playwright:
        # The production SDK deliberately stays inert when navigator.webdriver is true.
        # Disable Blink's automation exposure only for this fixture so it reaches the
        # real visitor navigation/keepalive path rather than testing the webdriver gate.
        browser = await playwright.chromium.launch(
            headless=True,
            **({"executable_path": chromium} if chromium else {}),
            args=["--disable-blink-features=AutomationControlled", trust(fixture)],
        )
        try:
            context = await browser.new_context()
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

            page = await context.new_page()
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            page.on("console", lambda message: console_messages.append({"type": message.type, "text": message.text}))
            page.on("request", lambda request: requests.append({"url": safe_url(request.url), "resourceType": request.resource_type}))
            await page.goto(f"{source_origin}/", wait_until="load")
            await page.wait_for_function("globalThis.PulseboardUsage != null", timeout=5000)
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
            diagnostics.update({"pageErrors": list(page_errors), "console": list(console_messages), "requests": list(requests)})
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
            # A routed collector races Chromium's document teardown. Use real sockets,
            # and release the unload preflight only after the replacement page is visible.
            fixture.navigation_complete = threading.Event()
            await page.locator("#leave").click()
            await expect(page.locator("#arrived")).to_be_visible()
            fixture.navigation_complete.set()
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
            assert not fixture.tls_alerts, list(fixture.tls_alerts)
            preflights = [item for item in fixture.trace if item['method'] == 'OPTIONS']
            # The SDK uses cache:no-store, bypassing even the max-age 600 cache.
            assert len(preflights) == 2, list(fixture.trace)
            assert preflights[1].get('afterNavigation') is True, list(fixture.trace)

            print(
                json.dumps(
                    {
                        "passed": True,
                        "transport": transport,
                        "actualSocketPreflights": len(preflights),
                        "unloadPreflightAfterNavigation": True,
                        "sdkCacheMode": "no-store",
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
            if fixture.navigation_complete is not None:
                fixture.navigation_complete.set()
            await browser.close()


async def cache_control(chromium=None):
    """Positive cache control, NOT an SDK modification or a navigation delivery proof."""
    NETWORK_TRACE.clear()
    with HttpsFixture(max_age=600) as fixture:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(
                headless=True, **({"executable_path": chromium} if chromium else {}),
                args=[trust(fixture)],
            )
            try:
                context = await browser.new_context()
                page = await context.new_page()
                await page.goto(fixture.source_origin, wait_until='load')
                observed = []
                for cache, expected in [('default', 1), ('default', 1), ('no-store', 2), ('no-store', 3)]:
                    result = await page.evaluate("""async ({endpoint, cache}) => {
                        const response = await fetch(endpoint, {
                            method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
                            cache, headers: {'Content-Type': 'application/json'}, body: '{"events":[]}',
                            signal: AbortSignal.timeout(5000),
                        });
                        await response.text();
                        return response.status;
                    }""", {'endpoint': fixture.collector_origin + '/v1/collect/mdviewer', 'cache': cache})
                    assert result == 202, result
                    count = sum(item['method'] == 'OPTIONS' for item in fixture.trace)
                    observed.append({'cache': cache, 'preflights': count})
                    assert count == expected, {'observed': observed, 'collectorTrace': list(fixture.trace)}
                assert len(fixture.receipts) == 4, len(fixture.receipts)
                print(json.dumps({'passed': True, 'transport': 'cache-control', 'observations': observed}))
            finally:
                await browser.close()


async def run(args):
    transports = ['http-cold', 'http-max-age-600', 'cache-control'] if args.transport == 'all' else [args.transport]
    for transport in transports:
        try:
            if transport == 'cache-control':
                await cache_control(args.chromium)
            else:
                with HttpsFixture(max_age=0 if transport == 'http-cold' else 600) as fixture:
                    try:
                        await exercise(transport, fixture, args.chromium)
                    except BaseException:
                        print(json.dumps({'collectorTrace': list(fixture.trace)}, indent=2))
                        raise
        except BaseException:
            print(json.dumps({'transport': transport, 'networkTrace': list(NETWORK_TRACE)}, indent=2))
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--transport', choices=['all', 'http-cold', 'http-max-age-600', 'cache-control'], default='all')
    parser.add_argument('--chromium', help='Optional existing Chromium executable for local testing')
    asyncio.run(run(parser.parse_args()))
