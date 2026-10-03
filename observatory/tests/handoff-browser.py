"""Real Desk export -> reviewed file -> local receiver, using synthetic evidence only.
Default: HTTP assets/native WebCrypto. --offline checks the new control and legacy export only.
"""
import argparse
import asyncio
import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('desk_browser', ROOT / 'tests/desk-browser.py')
DESK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DESK)
IDENTIFIED = 'Prepare identified handoff (v2)'


async def open_signal(page):
    await page.locator('[data-view=signals]').click()
    await expect(page.locator('#page-title')).to_have_text('Alerts')
    await page.get_by_role('button', name='See evidence ↗', exact=True).first.click()
    await expect(page.locator('#detail-dialog')).to_be_visible()


def receive_file(input_file, packet):
    with tempfile.TemporaryDirectory(prefix='pulseboard-browser-receiver-') as root:
        output = Path(root) / 'proposals'
        base = ['node', 'adapters/receive-handoff.mjs', '--input', str(input_file), '--project', packet['project']]
        def run(extra):
            return subprocess.run(base + extra, cwd=ROOT, capture_output=True, text=True, timeout=15)
        dry = run([])
        assert dry.returncode == 0, dry.stderr
        preview = json.loads(dry.stdout)['preview']
        assert not output.exists(), 'Preview must not create files'
        assert preview['source']['fingerprint'] == packet['fingerprint']
        output.mkdir()
        accept = ['--accept', '--reviewed-sha256', preview['reviewedFileSha256'], '--output-dir', str(output)]
        refused = run(accept)
        assert refused.returncode != 0 and 'synthetic' in refused.stderr
        assert list(output.iterdir()) == []
        accepted = run(accept + ['--allow-synthetic'])
        assert accepted.returncode == 0, accepted.stderr
        result = json.loads(accepted.stdout)
        assert result['status'] == 'created'
        stored = json.loads(Path(result['path']).read_text())
        assert stored['fields'] == preview['proposal']['fields']
        assert stored['source']['mode'] == 'demo' and stored['permissions'] == []
        assert stored['status'] == 'proposed'
        repeated = run(accept + ['--allow-synthetic'])
        assert repeated.returncode == 0 and json.loads(repeated.stdout)['status'] == 'duplicate'
        assert len(list(output.iterdir())) == 1


async def run(args):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=args.chromium or None)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
        await context.add_init_script("window.csp = []; document.addEventListener('securitypolicyviolation', e => window.csp.push(e.violatedDirective))")
        page = await context.new_page()
        errors, downloads, requests = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('download', lambda item: downloads.append(item))
        page.on('request', lambda request: requests.append(request.url))
        if args.offline:
            await page.set_content(DESK.offline_html(), wait_until='load')
        else:
            await page.goto(args.origin, wait_until='networkidle')
        await page.locator('#demo').click()
        await open_signal(page)
        await expect(page.get_by_role('button', name=IDENTIFIED, exact=True)).to_be_visible()
        # The original action is still exactly the v1 contract; cancellation creates no download.
        await page.get_by_role('button', name='Prepare a task handoff ↗', exact=True).click()
        legacy = json.loads(await page.locator('#export-preview').text_content())
        assert legacy['schema'] == 'pulseboard.handoff/1'
        await page.keyboard.press('Escape')
        assert downloads == []
        if args.offline:
            assert not errors, errors
            print(json.dumps({'passed': True, 'transport': 'offline control/legacy smoke only', 'pageErrors': errors}))
            await browser.close()
            return
        await open_signal(page)
        await page.get_by_role('button', name=IDENTIFIED, exact=True).click()
        await expect(page.locator('#export-dialog')).to_be_visible()
        text = await page.locator('#export-preview').text_content()
        packet = json.loads(text)
        assert packet['schema'] == 'pulseboard.handoff/2' and len(packet['fingerprint']) == 12
        assert {k: v for k, v in packet.items() if k not in ['schema', 'fingerprint']} == {k: v for k, v in legacy.items() if k != 'schema'}
        await expect(page.locator('#export-warning')).to_contain_text('SYNTHETIC DEMO')
        await expect(page.locator('#download-export')).to_be_disabled()
        assert downloads == []
        await page.locator('#export-confirm').check()
        async with page.expect_download() as event:
            await page.locator('#download-export').click()
        download = await event.value
        downloaded = Path(await download.path())
        assert downloaded.read_bytes() == text.encode('utf8')
        assert download.suggested_filename == 'pulseboard-demo-handoff-v2.json'
        receive_file(downloaded, packet)
        # Hold the native digest, rather than replacing it with fake hashes, to force the close/disconnect race.
        await page.evaluate('''() => {
          const digest = crypto.subtle.digest.bind(crypto.subtle);
          window.hashPending = null; window.holdHash = true;
          crypto.subtle.digest = (...args) => window.holdHash ? new Promise((resolve, reject) => {
            window.hashPending = () => { window.holdHash = false; digest(...args).then(resolve, reject); };
          }) : digest(...args);
        }''')
        for disconnect in [False, True]:
            await page.locator('#demo').click()
            await open_signal(page)
            await page.evaluate('window.hashPending = null; window.holdHash = true')
            trigger = page.get_by_role('button', name=IDENTIFIED, exact=True)
            await trigger.evaluate('node => { window.preparingButton = node; }')
            await trigger.click()
            await page.wait_for_function('typeof window.hashPending === "function"')
            if disconnect:
                # A 401 or another cleanup path invokes the same disconnect while a modal is open.
                await page.evaluate("document.querySelector('#disconnect').click()")
            else:
                await page.keyboard.press('Escape')
            await page.evaluate('window.hashPending()')
            await page.wait_for_function('window.preparingButton.disabled === false')
            await expect(page.locator('#export-dialog')).not_to_be_visible()
            if disconnect:
                await expect(page.locator('#mode')).to_have_text('NOT CONNECTED')
            assert len(downloads) == 1
        assert not any('/v1/' in url for url in requests), 'Demo handoff must not contact collector data routes'
        assert not errors, errors
        assert await page.evaluate('window.csp') == []
        print(json.dumps({'passed': True, 'transport': 'HTTP assets / native WebCrypto',
                          'checks': ['v1 compatibility', 'v2 identity', 'exact reviewed download', 'real CLI preview/accept/dedup', 'cancel/disconnect invalidates pending hash'],
                          'pageErrors': errors}))
        await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--origin', default='http://127.0.0.1:8788')
    parser.add_argument('--chromium', default=os.environ.get('PULSEBOARD_CHROMIUM'))
    asyncio.run(run(parser.parse_args()))
