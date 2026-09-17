#!/usr/bin/env python3
"""Real Chromium -> bounded client -> collector -> aggregate reconciliation for Alibi."""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

from playwright.sync_api import Route, Request, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
HOST_ORIGIN = "https://alibi-after-hours-preview.commit-atlas.workers.dev"
COLLECTOR_ORIGIN = "https://collector.test"
READ_TOKEN = "pulseboard-alibi-journey-browser-test-only"


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def wait_for(predicate: Callable[[], bool], message: str, timeout: float = 15.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError(message)


def http_json(url: str, *, token: str | None = None) -> dict:
    headers = {} if token is None else {"Authorization": f"Bearer {token}"}
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def build_observer() -> str:
    source = """
import { buildEmbed } from './adapters/build-embed.mjs';
process.stdout.write(buildEmbed('alibi', {
  endpoint: 'https://collector.test/v1/collect/alibi',
  release: '0.11.4',
  route: 'puzzle',
}));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", source],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def start_fixture(port: int) -> subprocess.Popen[str]:
    env = {
        **os.environ,
        "PORT": str(port),
        "READ_TOKEN": READ_TOKEN,
        "NODE_NO_WARNINGS": "1",
    }
    process = subprocess.Popen(
        ["node", "tests/alibi-journey-server.mjs"],
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    def ready() -> bool:
        if process.poll() is not None:
            stdout, stderr = process.communicate()
            raise RuntimeError(f"collector fixture exited early\nstdout:\n{stdout}\nstderr:\n{stderr}")
        try:
            payload = http_json(f"http://127.0.0.1:{port}/readyz")
            return payload.get("ready") is True
        except (OSError, ValueError, urllib.error.URLError):
            return False

    wait_for(ready, "collector fixture did not become ready")
    return process


def proxy_to_collector(route: Route, request: Request, local_origin: str, posts: list[dict]) -> None:
    parsed = urlparse(request.url)
    target = local_origin + parsed.path + (f"?{parsed.query}" if parsed.query else "")
    method = request.method
    body = request.post_data_buffer if method not in {"GET", "HEAD", "OPTIONS"} else None
    headers = {"Origin": HOST_ORIGIN}
    content_type = request.headers.get("content-type")
    if content_type:
        headers["Content-Type"] = content_type
    forwarded = urllib.request.Request(target, data=body, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(forwarded, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    response_body = response.read()
    allowed = {
        "content-type",
        "access-control-allow-origin",
        "access-control-allow-methods",
        "access-control-allow-headers",
        "access-control-max-age",
        "retry-after",
        "vary",
    }
    response_headers = {
        key: value
        for key, value in response.headers.items()
        if key.lower() in allowed
    }
    if method == "POST":
        posts.append(json.loads((body or b"{}").decode("utf-8")))
    route.fulfill(status=response.status, headers=response_headers, body=response_body)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.parse_args()
    port = free_port()
    local_origin = f"http://127.0.0.1:{port}"
    fixture = start_fixture(port)
    observer = build_observer()
    posts: list[dict] = []
    html = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Alibi journey fixture</title></head>
<body><main>Alibi journey fixture</main>
<script>
globalThis.ALIBI_CONFIG = { standalone: false };
globalThis.__ALIBI_TEST_CONTEXT = { route: 'puzzle', release: '0.11.4' };
globalThis.ALIBI_OBSERVATORY_CONTEXT = () => ({ ...globalThis.__ALIBI_TEST_CONTEXT });
</script>
<script src="/observer.js"></script>
</body></html>"""

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_page()
            # Production correctly rejects automated browsers. This fixture neutralises only
            # Playwright's automation marker so the otherwise real client path can be exercised.
            page.add_init_script(
                "Object.defineProperty(navigator, 'webdriver', { get: () => false });"
            )

            def host(route: Route, request: Request) -> None:
                path = urlparse(request.url).path
                if path == "/observer.js":
                    route.fulfill(status=200, content_type="application/javascript", body=observer)
                elif path == "/":
                    route.fulfill(status=200, content_type="text/html", body=html)
                else:
                    route.fulfill(status=404, body="")

            page.route(f"{HOST_ORIGIN}/**", host)
            page.route(
                f"{COLLECTOR_ORIGIN}/**",
                lambda route, request: proxy_to_collector(route, request, local_origin, posts),
            )
            page.goto(HOST_ORIGIN + "/", wait_until="load")
            sharing = page.locator("#pulseboard-usage-sharing")
            sharing.wait_for(state="attached")
            sharing.locator("summary").click()
            consent = sharing.locator("input[type=checkbox]")
            consent.wait_for(state="visible")

            assert page.evaluate("() => globalThis.PulseboardUsage.track('puzzle.started')") is False
            time.sleep(0.2)
            assert posts == [], "pre-consent events must not reach the collector"

            consent.check()
            wait_for(lambda: len(posts) == 1, "consented page view was not delivered")

            accepted = page.evaluate("""async () => {
              const track = event => globalThis.PulseboardUsage.track(event);
              const results = [
                track('puzzle.started'),
                track('hint.requested'),
                track('puzzle.failed'),
                track('puzzle.started'),
                track('puzzle.completed'),
                track('puzzle.started'),
              ];
              globalThis.__ALIBI_TEST_CONTEXT.route = 'home';
              results.push(track('puzzle.completed'));
              await globalThis.PulseboardUsage.flush();
              return results;
            }""")
            assert accepted == [True] * 7
            wait_for(lambda: len(posts) == 2, "journey batch was not delivered")

            consent.uncheck()
            before_withdrawal = len(posts)
            ignored = page.evaluate("""async () => {
              globalThis.__ALIBI_TEST_CONTEXT.route = 'puzzle';
              const accepted = globalThis.PulseboardUsage.track('puzzle.started');
              await globalThis.PulseboardUsage.flush();
              return accepted;
            }""")
            assert ignored is False
            time.sleep(0.2)
            assert len(posts) == before_withdrawal, "post-withdrawal event reached the collector"
            browser.close()

        snapshot = http_json(f"{local_origin}/v1/portfolio?days=7", token=READ_TOKEN)
        alibi = next(project for project in snapshot["projects"] if project["id"] == "alibi")
        operation = alibi["operations"][0]
        assert operation == {
            "id": "puzzle.solve",
            "version": 1,
            "attempts": 3,
            "completed": 1,
            "failed": 1,
            "open": 1,
            "retries": 2,
            "completion": operation["completion"],
            "releases": [
                {
                    "release": "0.11.4",
                    "attempts": 3,
                    "completed": 1,
                    "failed": 1,
                    "open": 1,
                    "retries": 2,
                }
            ],
        }
        assert operation["completion"]["numerator"] == 1
        assert operation["completion"]["denominator"] == 3
        assert abs(operation["completion"]["value"] - 1 / 3) < 1e-12
        assert alibi["flow"]["denominator"] == 0
        assert alibi["totals"]["events"] == 8
        assert alibi["totals"]["sessions"] == 1
        print("Alibi browser -> collector -> aggregate journey passed")
    finally:
        fixture.terminate()
        try:
            fixture.wait(timeout=5)
        except subprocess.TimeoutExpired:
            fixture.kill()
            fixture.wait(timeout=5)


if __name__ == "__main__":
    main()
