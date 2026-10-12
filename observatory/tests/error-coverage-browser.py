"""Real local server + SQLite: error coverage at desktop/mobile widths and old-collector compatibility."""
import argparse
import asyncio
import json
import os
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
TOKEN = 'error-coverage-browser-test-only-not-a-secret'
SERVER = r"""
import { readFileSync } from 'node:fs';
import { openDatabase } from './src/sqlite.mjs';
import { startLocalRunner, installShutdownHooks } from './src/local.mjs';
const DB = openDatabase(); DB.exec(readFileSync('./schema.sql', 'utf8'));
const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
const insert = DB.prepare(`INSERT INTO product_events
  (project,received,day,session,seq,name,route,release,ms,props,redacted,country,region,browser,os,device)
  VALUES('alibi',?,?,NULL,1,'js.error','puzzle','0.13.0',0,?,0,'unknown','unknown','unknown','unknown','desktop')`);
await DB.batch([...Array.from({length:500}, (_, i) => [i, i]).flat().map(i => 'A'.repeat(160) + i),
  ...Array.from({length:499}, (_, i) => 'B'.repeat(160) + i)]
  .map(message => insert.bind(now, day, JSON.stringify({kind:'Error', message}))));
const runner = await startLocalRunner({port:0, DB, READ_TOKEN:process.env.READ_TOKEN});
installShutdownHooks({close:async () => {await runner.close(); DB.close();}});
console.log(JSON.stringify({origin:runner.origin}));
"""

async def run(output):
    output.mkdir(parents=True, exist_ok=True)
    process = await asyncio.create_subprocess_exec('node', '--input-type=module', '-e', SERVER,
        cwd=ROOT, env={**os.environ, 'READ_TOKEN':TOKEN, 'NODE_NO_WARNINGS':'1'},
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        line = await asyncio.wait_for(process.stdout.readline(), timeout=15)
        if not line:
            raise RuntimeError((await process.stderr.read()).decode())
        origin = json.loads(line)['origin']
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            context = await browser.new_context(viewport={'width':1440, 'height':1100}, reduced_motion='reduce')
            await context.add_init_script("window.__csp=[]; document.addEventListener('securitypolicyviolation', e=>window.__csp.push(e.violatedDirective));")
            page = await context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            reading = await context.request.get(origin + '/v1/product/alibi?days=7', headers={'Authorization':'Bearer ' + TOKEN})
            assert reading.status == 200
            value = await reading.json()
            assert value['errorsTruncated'] is True and value['total'] == 1499
            assert len(value['errors']) == 1 and value['errors'][0]['n'] == 1000
            await page.goto(origin, wait_until='networkidle')
            await page.locator('#open-connect').click()
            await page.locator('#token').fill(TOKEN)
            await page.locator('#connect button[type=submit]').click()
            await expect(page.locator('#mode')).to_have_text('CONNECTED')
            await page.locator('[data-view=product]').click()
            await page.locator('#usage-project').select_option('alibi')
            panel = page.locator('section.panel').filter(has=page.get_by_role('heading', name='Errors', exact=True))
            await expect(panel).to_contain_text('PARTIAL ERROR ROLLUP')
            await expect(panel).to_contain_text('lower bounds')
            await expect(panel.get_by_role('columnheader', name='Count (at least)', exact=True)).to_be_visible()
            await expect(panel.locator('tbody tr')).to_have_count(1)
            await panel.screenshot(path=str(output/'partial-desktop.png'))
            await page.set_viewport_size({'width':390, 'height':900})
            await expect(panel).to_contain_text('ranking is incomplete')
            assert await page.evaluate('document.documentElement.scrollWidth') <= 390
            await panel.screenshot(path=str(output/'partial-mobile.png'))
            await page.locator('#usage-project').select_option('mdviewer')
            await expect(panel).to_contain_text('No errors reported in this window.')
            await expect(panel).not_to_contain_text('lower bounds')
            # Only this compatibility scenario removes metadata from a real response, simulating an older collector.
            async def old_collector(route):
                response = await route.fetch()
                payload = await response.json()
                payload.pop('errorsTruncated')
                await route.fulfill(response=response, json=payload)
            await page.route('**/v1/product/alibi?*', old_collector)
            await page.locator('#usage-project').select_option('alibi')
            await expect(panel).to_contain_text('ERROR COVERAGE UNKNOWN')
            await expect(panel).to_contain_text('not reported by this collector')
            await expect(panel.get_by_role('columnheader', name='Count (at least)', exact=True)).to_be_visible()
            assert not errors, errors
            assert await page.evaluate('window.__csp') == []
            await context.close()
            await browser.close()
            result = {'passed':True, 'transport':'real HTTP assets and SQLite; metadata removal only for old-collector compatibility',
                'checks':['1499-row historical fixture', 'partial count heading', 'desktop/mobile warning',
                    '390px layout', 'complete empty reading', 'unknown legacy coverage', 'no page/CSP errors']}
            (output/'result.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result))
    finally:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.communicate(), timeout=5)
            except asyncio.TimeoutError:
                process.kill()
                await process.communicate()

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=Path('/tmp/pulseboard-error-coverage'))
    asyncio.run(run(parser.parse_args().output))
