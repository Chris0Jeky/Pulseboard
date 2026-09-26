"""Desk interaction gate. Default uses real HTTP assets; --offline explicitly skips serving/CSP checks.
Install optional test dependency: python -m pip install playwright==1.57.0
Then: python -m playwright install chromium
Run a local collector first, or use --offline. No external product probes or collection are enabled.
"""
import argparse
import asyncio
import json
import os
import re
import subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
TOKEN = os.environ.get('READ_TOKEN', 'desk-browser-test-only-' + '0' * 40)


def offline_html():
    html = (PUBLIC / 'index.html').read_text()
    source = '\n'.join((PUBLIC / name).read_text() for name in ['desk-model.mjs', 'desk-demo.mjs', 'desk-bridge.mjs', 'desk-network.mjs', 'desk-release.mjs', 'desk-usage.mjs', 'dashboard.mjs'])
    source = re.sub(r'^import .*?;\n', '', source, flags=re.M)
    source = re.sub(r'\bexport (?=(?:async )?(?:const|function|class))', '', source)
    html = html.replace('<link rel="stylesheet" href="/dashboard.css">', '<style>' + (PUBLIC / 'dashboard.css').read_text() + '</style>')
    html = re.sub(r'<link rel="icon"[^>]+>', '', html)
    html = html.replace('<img src="/mark.svg" width="34" height="34" alt="">', (PUBLIC / 'mark.svg').read_text().replace('<svg ', '<svg width="34" height="34" '))
    return html.replace('<script type="module" src="/dashboard.mjs"></script>', '<script type="module">' + source + '</script>')


def fixture():
    code = "import {makeDemo} from './public/desk-demo.mjs'; const x=makeDemo('release'); x.mode='live'; console.log(JSON.stringify(x));"
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))


async def run(args):
    results = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=args.chromium or None)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
        # Recorded in the page so a violation survives every later navigation and is read back at the end.
        await context.add_init_script("window.__cspViolations = [];"
                                      "document.addEventListener('securitypolicyviolation',"
                                      " e => window.__cspViolations.push(e.violatedDirective + ' :: ' + e.blockedURI));")
        page = await context.new_page()
        errors, requests, console_errors = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        if args.offline:
            await page.set_content(offline_html(), wait_until='load')
        else:
            await page.goto(args.origin, wait_until='networkidle')
        await expect(page.locator('#mode')).to_have_text('NOT CONNECTED')
        assert not any('/v1/' in url for url in requests), 'Opening the desk must not read private data'
        results.append('empty onramp makes no API request')
        if not args.offline:
            # This one connection uses the real HTTP server and SQLite, before fault injection below.
            await page.locator('#open-connect').click()
            await page.locator('#token').fill(TOKEN)
            await page.locator('#connect button[type=submit]').click()
            await expect(page.locator('#mode')).to_have_text('CONNECTED')
            await expect(page.locator('#message')).to_contain_text('collection disabled')
            # Positive control: the recorder below can only prove an absence of /v1/ reads if it sees a real one here.
            assert any('/v1/portfolio' in url for url in requests), 'Request recording missed the authenticated read'
            assert not any('/v1/github-evidence' in url for url in requests), 'GitHub evidence must not join the poll'
            await page.locator('.project-name button').filter(has_text='Alibi').click()
            await page.get_by_role('button', name='Read workflow evidence').click()
            # Alibi is mapped, but this runner has no GITHUB_EVIDENCE_TOKEN: the real route answers no-token,
            # every mapped item reads unconfigured and nothing is requested from GitHub.
            await expect(page.locator('#github-evidence')).to_contain_text('NO-TOKEN')
            await expect(page.locator('#github-evidence')).to_contain_text('unconfigured · no-server-token')
            assert any('/v1/github-evidence?project=alibi' in url for url in requests)
            assert not any('api.github.com' in url for url in requests)
            await page.keyboard.press('Escape')
            await page.locator('#disconnect').click()
            results.append('real HTTP assets, protected API and SQLite connection')
        demo_mark = len(requests)
        await page.locator('#demo').click()
        await expect(page.locator('#mode')).to_have_text('SYNTHETIC DEMO')
        await page.locator('#search').fill('Alibi')
        assert await page.locator('.project-name').count() == 1
        await page.locator('#search').fill('')
        await page.locator('.project-name button').filter(has_text='Alibi').click()
        await expect(page.locator('#detail-dialog')).to_be_visible()
        await expect(page.locator('#detail')).to_contain_text('Paired flow')
        await expect(page.locator('#github-evidence')).to_contain_text('Not read')
        await page.get_by_role('button', name='Read workflow evidence').click()
        await expect(page.locator('#github-evidence')).to_contain_text('SYNTHETIC')
        await expect(page.locator('#github-evidence .notice')).to_contain_text('Temporal proximity, not a cause.')
        await page.get_by_role('button', name='Pin to release notebook').click()
        await expect(page.locator('#notebook-dialog')).to_be_visible()
        await page.locator('#suspected').fill('The deploy may have caused the probe failures.')
        await page.locator('#notebook button[value=md]').click()
        # Both fields are required: the browser keeps the notebook open instead of writing a half note.
        await expect(page.locator('#notebook-dialog')).to_be_visible()
        await page.locator('#alternative-check').fill('Check the hosting status page and the probe target first.')
        await page.locator('#notebook button[value=md]').click()
        await expect(page.locator('#export-preview')).to_contain_text('a lead, not proof')
        await expect(page.locator('#export-warning')).to_contain_text('SYNTHETIC DEMO.')
        await page.keyboard.press('Escape')
        results.append('demo, search, evidence drawer and synthetic GitHub notebook')
        await page.locator('[data-view=releases]').click()
        await expect(page.locator('#page-title')).to_have_text('Release lab.')
        await expect(page.locator('#view')).to_contain_text('percentage points')
        await page.locator('#release-baseline').select_option('0.6.1')
        await expect(page.locator('#view')).to_contain_text('Choose two different')
        await page.locator('[data-view=overview]').click()
        await expect(page.locator('#page-title')).to_have_text('The desk.')
        await page.locator('#replay').fill('0')
        assert await page.locator('#view .state-chip.down').count() == 0
        await page.locator('#replay').fill('1')
        assert await page.locator('#view .state-chip.down').count() == 1
        assert not any('/v1/' in url for url in requests[demo_mark:]), 'Replay and demo interaction must not read or write the collector'
        results.append('release guard and incident replay write nothing to the collector')
        await page.locator('[data-view=signals]').click()
        await expect(page.locator('#page-title')).to_have_text('Signal inbox.')
        before = await page.locator('.signal').count()
        await page.get_by_role('button', name='Review', exact=True).first.click()
        assert await page.locator('.signal').count() == before - 1
        await page.locator('[data-view=overview]').click()
        await expect(page.locator('#page-title')).to_have_text('The desk.')
        await page.locator('#brief').click()
        await expect(page.locator('#export-preview')).to_contain_text('SYNTHETIC DEMO')
        await expect(page.locator('#download-export')).to_be_disabled()
        previewed = await page.locator('#export-preview').text_content()
        await page.locator('#export-confirm').check()
        async with page.expect_download() as download_info:
            await page.locator('#download-export').click()
        download = await download_info.value
        assert 'demo-field-note' in download.suggested_filename
        # The reviewed bytes are the downloaded bytes: the preview is the file, not a summary of it.
        assert Path(await download.path()).read_text(encoding='utf-8') == previewed
        await expect(page.locator('#export-preview')).to_have_text('')
        results.append('downloaded file is byte-identical to the reviewed preview')
        await page.keyboard.press('Control+k')
        await expect(page.locator('#palette')).to_be_visible()
        await page.keyboard.press('Escape')
        await page.locator('#page-title').focus()
        await page.keyboard.press('/')
        await expect(page.locator('#search')).to_be_focused()
        await page.locator('[data-view=connections]').click()
        await expect(page.locator('#page-title')).to_have_text('Connections.')
        # The payload sits in a projected field the desk renders (ci.workflow), so the markup assertion is not vacuous.
        payload = '<img src=x onerror=alert(1)>'
        catalog = {'version': 2, 'generator': 'CommitAtlas', 'source': 'github-public-rest', 'user': 'example-builder',
                   'generatedAt': '2026-09-10T12:00:00Z', 'projects': [{'repo': 'example-project', 'label': 'Example project',
                   'lifecycle': 'active', 'ci': {'state': 'passing', 'workflow': payload}, 'stars': 1, 'forks': 0, 'openIssuesAndPullRequests': 3,
                   'description': 'PRIVATE_SENTINEL', 'actions': [{'url': 'https://never-fetch.invalid'}]}]}
        await page.locator('#import-commitatlas').set_input_files({'name': 'projects.json', 'mimeType': 'application/json', 'buffer': json.dumps(catalog).encode()})
        await expect(page.locator('#import-dialog')).to_be_visible()
        assert 'PRIVATE_SENTINEL' not in await page.locator('#import-preview').text_content()
        assert 'never-fetch' not in await page.locator('#import-preview').text_content()
        await page.locator('#accept-import').click()
        await expect(page.locator('#view')).to_contain_text('example-builder/example-project')
        assert payload in await page.locator('#view').text_content(), 'The rendered field must show the payload as literal text'
        assert await page.locator('#view img').count() == 0
        results.append('tab-local native catalogue projection renders injected markup as inert text')
        await page.locator('input[name=public-project][value=alibi]').check()
        # A refresh re-renders this view exactly as the background poll does; the selection must survive it.
        await page.locator('#refresh').click()
        await expect(page.locator('input[name=public-project][value=alibi]')).to_be_checked()
        await page.get_by_role('button', name='Preview public pulse', exact=True).click()
        packet = json.loads(await page.locator('#export-preview').text_content())
        assert len(packet['projects']) == 1 and packet['sourceMode'] == 'demo'
        assert 'PRIVATE_SENTINEL' not in json.dumps(packet) and 'sessions' not in json.dumps(packet)
        warning = await page.locator('#export-warning').text_content()
        assert warning.startswith('SYNTHETIC DEMO.'), warning
        await page.keyboard.press('Escape')
        results.append('selected public projection excludes usage and keeps the synthetic marking')
        await page.locator('#disconnect').click()
        assert 'example-builder' not in await page.locator('#view').text_content()
        # Deterministic response fault injection. This does not claim real production failures.
        await page.evaluate('''fixture => {
          window.deskTestFixture = fixture; window.deskTestStatus = 200; window.deskTestDelay = 0; window.deskTestBad = false; window.deskTestCalls = 0;
          window.fetch = async (_url, init = {}) => { const code = window.deskTestStatus, delay = window.deskTestDelay;
            window.deskTestCalls += 1;
            const payload = window.deskTestBad ? {schema:'bad'} : structuredClone(window.deskTestFixture);
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, delay);
              init.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, {once:true});
            });
            return new Response(JSON.stringify(payload), {status:code, headers:{'Content-Type':'application/json'}});
          };
        }''', fixture())
        await page.locator('#open-connect').click()
        await page.locator('#token').fill(TOKEN)
        await page.locator('#connect button[type=submit]').click()
        await expect(page.locator('#mode')).to_have_text('CONNECTED')
        assert await page.locator('#token').input_value() == ''
        await page.locator('[data-view=overview]').click()
        await expect(page.locator('#page-title')).to_have_text('The desk.')
        await page.evaluate('window.deskTestStatus = 503')
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('STALE SNAPSHOT')
        assert await page.locator('#view .state-chip.up').count() == 0
        # A failed refresh must not launder a last-known failure into an unremarkable "stale probe" chip.
        assert await page.locator('#view .state-chip.down').count() == 1
        await expect(page.locator('#view .state-chip.down')).to_contain_text('last known')
        assert await page.locator('#view .state-chip.down.last-known').count() == 1
        assert await page.locator('#view .state-chip.stale').count() > 0
        await expect(page.locator('#view')).to_contain_text('Alibi')
        await page.locator('[data-view=signals]').click()
        await expect(page.locator('#view')).to_contain_text('The latest refresh failed')
        await expect(page.locator('#view')).to_contain_text('last-known')
        await page.locator('[data-view=overview]').click()
        await page.set_viewport_size({'width': 390, 'height': 900})
        assert await page.evaluate('document.documentElement.scrollWidth') <= 390
        await page.set_viewport_size({'width': 1440, 'height': 1100})
        results.append('failed refresh qualifies inbox evidence and visually marks the last-known failure')

        await page.evaluate('window.deskTestStatus = 200; window.deskTestBad = false; window.deskTestDelay = 0')
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('CONNECTED')
        calls_before_hide = await page.evaluate('window.deskTestCalls')
        emulation = await page.evaluate('''() => {
          let hidden = false;
          Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
          Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
          window.deskTestSetVisibility = value => {
            hidden = Boolean(value);
            document.dispatchEvent(new Event('visibilitychange'));
            return { hidden: document.hidden, state: document.visibilityState };
          };
          return window.deskTestSetVisibility(true);
        }''')
        assert emulation == {'hidden': True, 'state': 'hidden'}
        await page.evaluate("document.querySelector('#refresh').click()")
        await page.wait_for_timeout(150)
        assert await page.evaluate('window.deskTestCalls') == calls_before_hide
        visible = await page.evaluate('window.deskTestSetVisibility(false)')
        assert visible == {'hidden': False, 'state': 'visible'}
        resumed = calls_before_hide
        for _ in range(40):
            resumed = await page.evaluate('window.deskTestCalls')
            if resumed > calls_before_hide:
                break
            await page.wait_for_timeout(50)
        assert resumed > calls_before_hide
        await expect(page.locator('#refresh')).to_be_enabled()
        results.append('hidden visibility suppresses reads and becoming visible resumes one')

        await page.evaluate('window.deskTestDelay = 11000')
        loop = asyncio.get_running_loop()
        started = loop.time()
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('STALE SNAPSHOT', timeout=12500)
        elapsed = loop.time() - started
        assert 9 <= elapsed < 12.5, elapsed
        await page.evaluate('window.deskTestDelay = 0')
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('CONNECTED')
        results.append('hung reads abort at the ten-second boundary')

        await page.evaluate('window.deskTestStatus = 200; window.deskTestBad = true')
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('STALE SNAPSHOT')
        await expect(page.locator('#view')).to_contain_text('Alibi')
        await page.evaluate('window.deskTestBad = false; window.deskTestStatus = 401')
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('NOT CONNECTED')
        assert await page.locator('.project-name').count() == 0
        results.append('malformed payload preserves evidence; 401 clears private state')
        await page.evaluate('window.deskTestStatus = 200; window.deskTestDelay = 300')
        await page.locator('#open-connect').click()
        await page.locator('#token').fill(TOKEN)
        await page.locator('#connect button[type=submit]').click()
        await page.locator('#disconnect').click()
        await page.wait_for_timeout(450)
        await expect(page.locator('#mode')).to_have_text('NOT CONNECTED')
        results.append('late responses cannot reconnect a disconnected desk')
        if not args.offline:
            stored = await page.evaluate('JSON.stringify({...localStorage})')
            assert TOKEN not in stored and 'PRIVATE_SENTINEL' not in stored
            assert not any('never-fetch.invalid' in url for url in requests)
            results.append('no token or imported payload persisted; import URLs never fetched')
        await page.locator('#demo').click()
        await page.locator('[data-view=overview]').click()
        await expect(page.locator('#page-title')).to_have_text('The desk.')
        if args.screenshots:
            args.screenshots.mkdir(parents=True, exist_ok=True)
            await page.screenshot(path=str(args.screenshots / 'desk-desktop.png'), full_page=True)
        for width in [390, 768, 1440]:
            await page.set_viewport_size({'width': width, 'height': 900})
            assert await page.evaluate('document.documentElement.scrollWidth') <= width
        await page.set_viewport_size({'width': 390, 'height': 844})
        if args.screenshots:
            await page.screenshot(path=str(args.screenshots / 'desk-mobile.png'), full_page=True)
        await page.evaluate("window.dispatchEvent(new PageTransitionEvent('pagehide'))")
        await expect(page.locator('#mode')).to_have_text('NOT CONNECTED')
        results.append('responsive widths, reduced-motion mode and pagehide cleanup')
        assert not errors, errors
        violations = [] if args.offline else await page.evaluate('window.__cspViolations || []')
        assert not violations, violations
        assert not console_errors, console_errors
        results.append('no console error in the whole session' if args.offline else 'no CSP violation or console error in the whole session')
        print(json.dumps({'transport': 'offline inlined assets / mocked failures' if args.offline else 'HTTP assets / real initial API / mocked failure scenarios',
                          'passed': len(results), 'checks': results, 'pageErrors': errors, 'cspViolations': violations, 'consoleErrors': console_errors}, indent=2))
        await browser.close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--origin', default='http://127.0.0.1:8788')
    parser.add_argument('--chromium', default=os.environ.get('PULSEBOARD_CHROMIUM'))
    parser.add_argument('--screenshots', type=Path)
    asyncio.run(run(parser.parse_args()))
