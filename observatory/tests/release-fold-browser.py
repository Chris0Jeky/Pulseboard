"""Render folded release evidence from real SQLite fixtures; never contact product origins.
HTTP assets by default; --offline is only a layout/interaction fallback, not a serving/CSP check.
"""
import argparse
import asyncio
import importlib.util
import json
import os
import subprocess
from pathlib import Path
from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('desk_browser', ROOT / 'tests/desk-browser.py')
DESK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DESK)


def fixture():
    source = """
      import {readFileSync} from 'node:fs';
      import {openDatabase} from './src/sqlite.mjs';
      import {readPortfolio} from './src/portfolio.mjs';
      import {readStatistics} from './src/statistics.mjs';
      import {projects} from './src/projects.mjs';
      const DB = openDatabase(), now = Date.now(), day = new Date(now).toISOString().slice(0,10);
      DB.exec(readFileSync('schema.sql', 'utf8'));
      const rows = [...Array.from({length:63}, (_, i) => [`1.0.${i}`, 2, now-10000-i]), ['unattributed', 1, now-1], ['9.9.9', 1, now-1]];
      for (const [release, n, received] of rows) {
        await DB.prepare('INSERT INTO statistics VALUES(?,?,?,?,?,?,?)').bind('alibi', day, 'page.view', 'home', release, n, received).run();
        for(let i=0;i<n;i++) await DB.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?)')
          .bind('alibi',crypto.randomUUID(),received,crypto.randomUUID(),1,'page.view','home',release,null).run();
      }
      console.log(JSON.stringify({portfolio: await readPortfolio(DB, {now, collectionEnabled:true, admittedProjects:['alibi'],projects:{alibi:projects.alibi}}),
        statistics:await readStatistics(DB,{now,admitted:true})})); DB.close();
    """
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', source], cwd=ROOT, text=True))


async def run(args):
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=args.chromium or None)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000})
        await context.add_init_script("window.csp = []; document.addEventListener('securitypolicyviolation', e => window.csp.push(e.violatedDirective))")
        page = await context.new_page()
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        if args.offline:
            await page.set_content(DESK.offline_html(), wait_until='load')
        else:
            await page.goto(args.origin, wait_until='networkidle')
        await page.evaluate('''fixtures => {
          window.fetch = async url => {
            if (url === '/v1/portfolio?days=7&version=3') return Response.json(fixtures.portfolio);
            if (url === '/v1/statistics/alibi?days=7') return Response.json(fixtures.statistics);
            throw new Error('Unexpected fixture request: ' + url);
          };
        }''', fixture())
        await page.locator('#open-connect').click()
        await page.locator('#token').fill(DESK.TOKEN)
        await page.locator('#connect button[type=submit]').click()
        await expect(page.locator('#mode')).to_have_text('CONNECTED')
        await page.locator('[data-view=signals]').click()
        await expect(page.locator('#view')).to_contain_text('some version detail is combined')
        await page.locator('[data-view=overview]').click()
        await page.locator('.project-name button').click()
        await expect(page.locator('#detail')).to_contain_text('other (smaller versions combined)')
        await page.keyboard.press('Escape')
        await page.locator('[data-view=usage]').click()
        await expect(page.locator('#view')).to_contain_text('63 individually shown release labels')
        await expect(page.locator('#view')).to_contain_text('additional labels are combined')
        await expect(page.get_by_role('meter', name='other (smaller versions combined): 2 of 128', exact=True)).to_be_visible()
        await page.set_viewport_size({'width': 390, 'height': 900})
        assert await page.evaluate('document.documentElement.scrollWidth') <= 390
        assert not any('/v1/' in url for url in requests), 'Fixture reads must not escape to the collector'
        assert not errors, errors
        if not args.offline:
            assert await page.evaluate('window.csp') == []
        print(json.dumps({'passed': True, 'transport': 'offline layout' if args.offline else 'HTTP assets / SQLite response fixtures',
                          'checks': ['drawer label', 'Usage label count', 'meter accessible name', '390px layout'], 'pageErrors': errors}))
        await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--origin', default='http://127.0.0.1:8788')
    parser.add_argument('--chromium', default=os.environ.get('PULSEBOARD_CHROMIUM'))
    asyncio.run(run(parser.parse_args()))
