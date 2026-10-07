"""Real HTTP assets/CSP/WebCrypto with explicitly synthetic SQLite read-model fixtures.
No collection, probes, credentials from accounts, or public publication is used.
"""
import argparse
import asyncio
import copy
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TOKEN = os.environ.get('READ_TOKEN', 'pulseboard-browser-ci-only-do-not-use-in-production')


def snapshot(version=3, extra=0):
    source = r"""
import {readFileSync} from 'node:fs';
import {openDatabase} from './src/sqlite.mjs';
import {readPortfolio} from './src/portfolio.mjs';
import {assertPortfolio} from './public/desk-bridge.mjs';
const db=openDatabase(), now=Date.now(); db.exec(readFileSync('schema.sql','utf8'));
const rows=[['puzzle.started','0.11.4'],['puzzle.completed','0.11.4'],['puzzle.completed','0.11.4'],
 ['puzzle.failed','0.11.4'],['puzzle.completed','0.11.5'],['puzzle.completed','<img src=x onerror=alert(1)>']];
for(let i=0;i<EXTRA;i++)rows.push(['puzzle.completed','0.11.4']);
await db.batch(rows.map(([event,release],i)=>db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,NULL)')
 .bind('alibi',`synthetic-${i}`,now-1000,'synthetic-session',i+1,event,'puzzle',release)));
console.log(JSON.stringify(assertPortfolio(await readPortfolio(db,{now,days:7,version:VERSION,
 collectionEnabled:true,admittedProjects:['alibi']}))));db.close();
""".replace('EXTRA', str(extra)).replace('VERSION', str(version))
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', source], cwd=ROOT, text=True))


async def run(args):
    original, newer, old = snapshot(), snapshot(extra=6), snapshot(version=2)
    response = {'value': original}
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True, executable_path=args.chromium or None)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
        await context.add_init_script("window.csp=[];document.addEventListener('securitypolicyviolation',e=>window.csp.push(e.violatedDirective))")
        page = await context.new_page()
        errors, requests, downloads = [], [], []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('request', lambda r: requests.append(r.url))
        page.on('download', lambda d: downloads.append(d))
        if args.offline:
            spec = importlib.util.spec_from_file_location('desk_browser', ROOT / 'tests/desk-browser.py')
            desk = importlib.util.module_from_spec(spec); spec.loader.exec_module(desk)
            await page.set_content(desk.offline_html(), wait_until='load')
        else:
            served = await page.goto(args.origin, wait_until='networkidle')
            assert "script-src 'self'" in served.headers['content-security-policy']
            # These two reads hit the actual local Worker handler/SQLite, not the fixture route.
            assert (await context.request.get(args.origin+'/v1/portfolio?version=3')).status == 401
            actual = await context.request.get(args.origin+'/v1/portfolio?version=3', headers={'authorization': 'Bearer '+TOKEN})
            assert actual.status == 200 and (await actual.json())['schema'] == 'pulseboard.portfolio/3'
            default = await context.request.get(args.origin+'/v1/portfolio', headers={'authorization': 'Bearer '+TOKEN})
            assert default.status == 200 and (await default.json())['schema'] == 'pulseboard.portfolio/2'
            assert actual.headers['cache-control'] == 'no-store'
        async def route_read(route):
            assert parse_qs(urlparse(route.request.url).query)['version'] == ['3']
            await route.fulfill(status=200, content_type='application/json', body=json.dumps(response['value']))
        if args.offline:
            await page.evaluate('''value => {
              window.operationFixture = value;
              window.fetch = async url => {
                if (url !== '/v1/portfolio?days=7&version=3') throw new Error('Unexpected fixture read');
                return Response.json(window.operationFixture);
              };
            }''', original)
        else:
            await page.route('**/v1/portfolio?*', route_read)
        await page.locator('#open-connect').click()
        await page.locator('#token').fill(TOKEN)
        await page.locator('#connect button[type=submit]').click()
        await expect(page.locator('#mode')).to_have_text('CONNECTED')
        await page.locator('.project-name button').filter(has_text='Alibi').click()
        section = page.get_by_role('region', name='Named operation evidence', exact=True)
        await expect(section).to_be_visible()
        await expect(section).to_contain_text('Legacy session events')
        await expect(section).to_contain_text('0.11.5')
        await expect(section).to_contain_text('<img src=x onerror=alert(1)>')
        assert await section.locator('img').count() == 0
        # Visibility cancels reads, not the operator's pinned inspection. Simulate the
        # actual visibility event handler without relying on headless tab throttling.
        await page.evaluate('''() => {
          let hidden = false;
          Object.defineProperty(document, 'hidden', {configurable:true, get:()=>hidden});
          window.operationVisibility = value => {
            hidden = value; document.dispatchEvent(new Event('visibilitychange'));
          };
        }''')
        # A poll replaces global state; the open drawer and its links must retain their own source.
        before = await section.inner_text()
        response['value'] = newer
        if args.offline:
            await page.evaluate('value => { window.operationFixture = value; document.querySelector("#refresh").click(); }', newer)
            await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        else:
            async with page.expect_response('**/v1/portfolio?*'):
                await page.evaluate("document.querySelector('#refresh').click()")
        await expect(page.locator('#refresh')).to_be_enabled()
        assert await section.inner_text() == before
        await page.evaluate('operationVisibility(true); operationVisibility(false)')
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await expect(page.locator('#refresh')).to_be_enabled()
        await section.get_by_role('button', name='Review unmatched outcomes', exact=True).click()
        await expect(page.locator('#detail-title')).to_contain_text('unmatched')
        evidence = json.loads(await page.locator('#detail .code-evidence').text_content())
        assert evidence['unmatched'] == {'completed': 3, 'failed': 1}
        await page.get_by_role('button', name='Inspect operation evidence', exact=True).click()
        assert await section.inner_text() == before
        await page.evaluate('operationVisibility(true); operationVisibility(false)')
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await expect(page.locator('#refresh')).to_be_enabled()
        await section.get_by_role('button', name='Review unmatched outcomes', exact=True).click()
        await page.evaluate('operationVisibility(true); operationVisibility(false)')
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await expect(page.locator('#refresh')).to_be_enabled()
        await page.get_by_role('button', name='Prepare a task handoff ↗' if args.offline else 'Prepare identified handoff (v2)', exact=True).click()
        await expect(page.locator('#export-dialog')).to_be_visible()
        text = await page.locator('#export-preview').text_content()
        packet = json.loads(text)
        assert packet['schema'] == ('pulseboard.handoff/1' if args.offline else 'pulseboard.handoff/2')
        assert packet['rule']['version'] == 'operation-evidence/1'
        assert packet['generatedAt'] == original['generatedAt'] and packet['window'] == original['window']
        assert packet['evidence']['unmatched'] == evidence['unmatched']
        assert downloads == []
        await expect(page.locator('#download-export')).to_be_disabled()
        await page.locator('#export-confirm').check()
        async with page.expect_download() as event:
            await page.locator('#download-export').click()
        download = await event.value
        assert Path(await download.path()).read_bytes() == text.encode('utf8')
        preview = subprocess.run(['node','adapters/receive-handoff.mjs','--input',await download.path(),'--project','alibi'],
                                 cwd=ROOT,capture_output=True,text=True,timeout=15)
        assert preview.returncode == 0, preview.stderr
        assert json.loads(preview.stdout)['preview']['proposal']['permissions'] == []
        await page.keyboard.press('Escape')
        # Malformed v3 must retain the last good source, visibly qualified as last-known.
        invalid = copy.deepcopy(newer); del next(p for p in invalid['projects'] if p['id']=='alibi')['operations'][0]['unmatched']
        response['value'] = invalid
        if args.offline: await page.evaluate('value => {window.operationFixture = value}', invalid)
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('STALE SNAPSHOT')
        await page.locator('.project-name button').filter(has_text='Alibi').click()
        await expect(section).to_contain_text('LAST-KNOWN')
        await section.get_by_role('button', name='Review unmatched outcomes', exact=True).click()
        await expect(page.locator('#detail-title')).to_contain_text('last-known')
        await page.get_by_role('button', name='Prepare a task handoff ↗', exact=True).click()
        await expect(page.locator('#export-dialog')).to_be_visible()
        stale = json.loads(await page.locator('#export-preview').text_content())
        assert stale['stale'] is True and stale['evidence']['lastKnown'] is True
        await page.keyboard.press('Escape')
        # Older collectors may ignore version. Their absent detail is not a zero.
        response['value'] = old
        if args.offline: await page.evaluate('value => {window.operationFixture = value}', old)
        await page.locator('#refresh').click()
        await expect(page.locator('#mode')).to_have_text('CONNECTED')
        await page.locator('.project-name button').filter(has_text='Alibi').click()
        await expect(section).to_contain_text('unavailable')
        await section.get_by_role('button', name='Review unavailable detail', exact=True).click()
        assert json.loads(await page.locator('#detail .code-evidence').text_content())['unmatched'] is None
        await page.keyboard.press('Escape')
        # The normal Alerts -> evidence path must expose the same operation drawer.
        await page.locator('[data-view=signals]').click()
        await page.locator('article.signal').filter(has_text='operation.puzzle.solve.missingness_unavailable').get_by_role('button', name='See evidence ↗').click()
        await page.get_by_role('button', name='Inspect operation evidence', exact=True).click()
        await expect(section).to_be_visible()
        await page.keyboard.press('Escape')
        await page.locator('#demo').click()
        await page.locator('#scenario').select_option('blind')
        await page.locator('[data-view=overview]').click()
        await page.set_viewport_size({'width':390,'height':900})
        await page.locator('.project-name button').filter(has_text='Alibi').click()
        await expect(section).to_contain_text('SYNTHETIC DEMO')
        assert await page.evaluate('document.documentElement.scrollWidth') <= 390
        assert await section.evaluate('n=>n.getBoundingClientRect().right') <= 390
        await section.locator('summary').click()
        release_table = section.get_by_role('region', name='puzzle.solve outcomes by release')
        await expect(release_table).to_be_visible()
        assert await release_table.evaluate('n=>n.scrollWidth > n.clientWidth')
        assert await page.evaluate('document.documentElement.scrollWidth') <= 390
        if args.screenshot:
            await section.scroll_into_view_if_needed()
            await page.screenshot(path=args.screenshot)
        await section.get_by_role('button', name='Review unmatched outcomes', exact=True).click()
        await page.get_by_role('button', name='Prepare a task handoff ↗', exact=True).click()
        assert json.loads(await page.locator('#export-preview').text_content())['mode'] == 'demo'
        await expect(page.locator('#export-warning')).to_contain_text('SYNTHETIC DEMO')
        assert len(downloads) == 1
        if args.offline:
            # About:blank has no native SubtleCrypto. A deterministic digest stub
            # tests only the button's async lifecycle; the HTTP path tests native
            # hashing and actual receiver validation above. No stub bytes download.
            await page.keyboard.press('Escape')
            await page.locator('.project-name button').filter(has_text='Alibi').click()
            await section.get_by_role('button', name='Review unmatched outcomes', exact=True).click()
            await page.evaluate('''() => {
              Object.defineProperty(window.crypto, 'subtle', {configurable:true,
                value:{digest:async()=>new Uint8Array(32).buffer}});
              operationVisibility(true); operationVisibility(false);
            }''')
            # Cancel one preparation during its digest, then allow a fresh click.
            await page.evaluate('''() => {
              let paused = false;
              window.crypto.subtle.digest = async () => {
                if (!paused) {paused=true; await new Promise(resolve=>window.releaseDigest=resolve);}
                return new Uint8Array(32).buffer;
              };
            }''')
            identified = page.get_by_role('button', name='Prepare identified handoff (v2)', exact=True)
            await identified.click()
            await page.wait_for_function('typeof window.releaseDigest === "function"')
            await page.evaluate('operationVisibility(true); operationVisibility(false); releaseDigest()')
            await expect(identified).to_be_enabled()
            await expect(page.locator('#export-dialog')).not_to_be_visible()
            await identified.click()
            await expect(page.locator('#export-dialog')).to_be_visible()
            assert json.loads(await page.locator('#export-preview').text_content())['schema'] == 'pulseboard.handoff/2'
            assert len(downloads) == 1
            await page.keyboard.press('Escape')
        assert not errors, errors
        if not args.offline: assert await page.evaluate('window.csp') == []
        assert all('/v1/portfolio?' in url for url in requests if '/v1/' in url), requests
        print(json.dumps({'passed':True,'transport':'offline DOM/v1 export; no HTTP/CSP/WebCrypto claim' if args.offline else 'HTTP assets/native WebCrypto; synthetic SQLite read fixtures',
                          'checks':([] if args.offline else ['v2/v3 authenticated API','native v2 digest','CSP']) + ['drawer/signal round trip','pinned evidence after poll','visibility resumes pinned review',
                                    'exact reviewed download and receiver preview','malformed-refresh retention',
                                    'v2 unavailable detail','inert markup','390px layout','synthetic markings','no extra reads']}))
        await browser.close()

if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--offline',action='store_true')
    parser.add_argument('--origin',default='http://127.0.0.1:8788')
    parser.add_argument('--chromium',default=os.environ.get('PULSEBOARD_CHROMIUM'))
    parser.add_argument('--screenshot')
    asyncio.run(run(parser.parse_args()))
