"""Focused Desk regressions, with real HTTP by default and explicit offline fallback.
Uses the same pinned Playwright installation as desk-browser.py; no collection is enabled.
"""
import argparse
import asyncio
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('desk_browser', ROOT / 'tests/desk-browser.py')
DESK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DESK)


async def focus_contained(page, dialog):
    await expect(dialog).to_be_visible()
    assert await dialog.evaluate("d => d.matches(':modal')")
    await dialog.evaluate('''d => {
      window.focusEscapes = [];
      window.recordFocus = event => {
        if (d.matches(':modal') && !d.contains(event.target)) window.focusEscapes.push(event.target.tagName);
      };
      document.addEventListener('focusin', window.recordFocus);
    }''')
    try:
        # Repeated complete cycles catch both the end wrap and reverse wrap, including a transient escape.
        seen = set()
        for key in ['Tab'] * 24 + ['Shift+Tab'] * 24:
            await page.keyboard.press(key)
            active = await dialog.evaluate('''d => ({ inside: d.contains(document.activeElement),
              tag: document.activeElement.tagName, id: document.activeElement.id,
              label: document.activeElement.getAttribute('aria-label') || document.activeElement.textContent.slice(0, 80) })''')
            assert active['inside'], (key, active)
            seen.add((active['tag'], active['id'], active['label']))
        assert len(seen) >= 3, 'Focus containment must not pin every Tab to the same control'
        assert await page.evaluate('window.focusEscapes') == []
    finally:
        await page.evaluate("document.removeEventListener('focusin', window.recordFocus)")


async def check_focus(page):
    # Real openers, not showModal() calls in the test: native Escape and focus restoration stay in use.
    for opener, selector in [('#open-connect', '#connect-dialog'),
                             ('.project-name button', '#detail-dialog'),
                             ('#commands', '#palette'), ('#brief', '#export-dialog')]:
        trigger = page.locator(opener).first
        await trigger.click()
        dialog = page.locator(selector)
        await focus_contained(page, dialog)
        await page.keyboard.press('Escape')
        await expect(dialog).not_to_be_visible()
        await expect(trigger).to_be_focused()
    # Recompute endpoints after controls change. A disabled/hidden submit is not a tab stop.
    await page.locator('#open-connect').click()
    submit = page.locator('#connect button[type=submit]')
    for attr in ['disabled', 'hidden']:
        await submit.evaluate('(node, attr) => node.setAttribute(attr, "")', attr)
        await page.locator('#remember').focus()
        await page.keyboard.press('Tab')
        await expect(page.get_by_role('button', name='Close connection dialog')).to_be_focused()
        await page.keyboard.press('Shift+Tab')
        await expect(page.locator('#remember')).to_be_focused()
        await submit.evaluate('(node, attr) => node.removeAttribute(attr)', attr)
    await page.locator('#remember').focus()
    await page.keyboard.press('Tab')
    await expect(submit).to_be_focused()
    await page.keyboard.press('Tab')
    await expect(page.get_by_role('button', name='Close connection dialog')).to_be_focused()
    await page.keyboard.press('Escape')
    # Outside the dialog, the next Tab is again the browser's ordinary page navigation.
    await page.locator('#search').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('#commands')).to_be_focused()


async def check_navigation(page):
    alerts = page.locator('[data-view=signals]')
    for scenario, count in [('quiet', 0), ('release', 3), ('pressure', 7)]:
        await page.locator('#scenario').select_option(scenario)
        await expect(alerts.locator('#signal-count')).to_have_text(str(count))
        await expect(alerts.locator('kbd')).to_have_text('2')
        await expect(alerts).to_have_accessible_name(re.compile(rf'Alerts\s+{count}\s+open alerts; shortcut\s+2'))
        await expect(alerts).to_have_attribute('aria-keyshortcuts', '2')
    await page.locator('#page-title').focus()
    await page.keyboard.press('2')
    await expect(page.locator('#page-title')).to_have_text('Alerts')
    await page.locator('#page-title').focus()
    await page.keyboard.press('7')
    await expect(page.locator('#page-title')).to_have_text('Voices')
    await page.set_viewport_size({'width': 390, 'height': 900})
    assert await page.evaluate('document.documentElement.scrollWidth') <= 390
    await page.set_viewport_size({'width': 1440, 'height': 1100})
    await page.locator('[data-view=overview]').click()
    await page.locator('#scenario').select_option('release')


async def check_filter(page):
    register = page.get_by_role('region', name='Project register; scroll horizontally on small screens')
    for query, expected in [('Alibi', 1), ('zzz-no-match', 0), ('', 8)]:
        await page.locator('#search').fill(query)
        await expect(page.locator('.project-name')).to_have_count(expected)
        await expect(page.locator('#view')).to_contain_text(f'{expected} shown.')
        if expected:
            await expect(register.locator('tbody tr')).to_have_count(expected)
            assert all(text.strip() for text in await register.locator('tbody tr').all_text_contents())
        else:
            await expect(register).to_have_count(0)
            await expect(page.get_by_text('No matches.', exact=True)).to_be_visible()
        # #177 counted the daily-chart disclosure's rows as empty project rows. Closed <details>
        # can report row rectangles even though its content is not painted. Check the right table
        # and the disclosure's actual layout, with an expansion positive control.
        disclosure = page.locator('.chart-data')
        assert not await disclosure.evaluate('d => d.open')
        closed_height = await disclosure.evaluate('d => d.getBoundingClientRect().height')
        await disclosure.locator('summary').click()
        assert await disclosure.evaluate('d => d.open')
        assert await disclosure.evaluate('d => d.getBoundingClientRect().height') > closed_height + 100
        await disclosure.locator('summary').click()
        assert await disclosure.evaluate('d => d.getBoundingClientRect().height') == closed_height
    await page.locator('#search').fill('')



async def connect(page):
    await page.locator('#open-connect').click()
    await page.locator('#token').fill(DESK.TOKEN)
    await page.locator('#connect button[type=submit]').click()
    await expect(page.locator('#mode')).to_have_text('CONNECTED')


async def check_usage(page, offline):
    await page.locator('[data-view=usage]').click()
    await expect(page.locator('#view')).to_contain_text('Hour of day')
    await page.locator('#usage-window').select_option('90')
    await expect(page.locator('#view')).to_contain_text('Referrer host')
    await page.locator('#usage-window').select_option('7')
    await page.locator('[data-view=overview]').click()
    await page.locator('#disconnect').click()
    if not offline:
        # Real assets/server/SQLite route, before replacing fetch with deterministic failure fixtures.
        async with page.expect_response(lambda r: '/v1/statistics/alibi?days=7' in r.url) as response:
            await connect(page)
            await page.locator('[data-view=usage]').click()
        reading = await response.value
        assert reading.status == 200
        data = await reading.json()
        assert data['schema'] == 'pulseboard.statistics/4' and data['project'] == 'alibi'
        assert data['window']['days'] == 7 and data['total'] == 0
        await expect(page.get_by_role('region', name='Alibi usage summary')).to_contain_text('No counts in this window')
        assert await page.evaluate("localStorage.getItem('pulseboard.desk.token')") == DESK.TOKEN
        await page.locator('[data-view=overview]').click()
        await page.locator('#disconnect').click()
    code = """import {makeStatisticsDemo} from './public/desk-usage.mjs';
      console.log(JSON.stringify(Object.fromEntries([1,7,90].map(days => {
        const data = makeStatisticsDemo(days); delete data.mode; return [days,data];
      }))));"""
    samples = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT, text=True))
    await page.evaluate('''fixtures => {
      window.usageStatus = 200; window.usageReads = []; window.releaseUsage = null;
      window.fetch = async url => {
        const parsed = new URL(url, 'https://desk.test');
        if (parsed.pathname === '/v1/portfolio') return Response.json(fixtures.portfolio);
        if (!parsed.pathname.startsWith('/v1/statistics/')) throw new Error('Unexpected fixture request');
        const days = parsed.searchParams.get('days'), status = window.usageStatus;
        window.usageReads.push(days);
        // Deliberately ignore cancellation: a completed old response must not replace a newer window.
        if (days === '1') await new Promise(resolve => { window.releaseUsage = resolve; });
        return Response.json(fixtures.statistics[days], {status});
      };
    }''', {'portfolio': DESK.fixture(), 'statistics': samples})
    await connect(page)
    await page.locator('[data-view=usage]').click()
    await expect(page.get_by_role('region', name='Alibi usage summary')).to_be_visible()
    await page.locator('#usage-window').select_option('1')
    await page.wait_for_function('typeof window.releaseUsage === "function"')
    await page.locator('#usage-window').select_option('90')
    await expect(page.locator('#view')).to_contain_text(samples['90']['window']['startDay'])
    await page.evaluate('window.releaseUsage()')
    # Flush the old response through JSON parsing and rendering, without a sleep-based network race.
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await expect(page.locator('#usage-window')).to_have_value('90')
    await expect(page.locator('#view')).to_contain_text(samples['90']['window']['startDay'])
    assert await page.evaluate('window.usageReads') == ['7', '1', '90']
    # Positive control for cross-view cleanup: import actual context through the reviewed file UI.
    # An empty Product/Voices/import state cannot prove that a Usage 401 clears unrelated private data.
    await page.locator('[data-view=connections]').click()
    catalog = {'version': 2, 'generator': 'CommitAtlas', 'source': 'github-public-rest', 'user': 'example-builder',
               'generatedAt': '2026-09-10T12:00:00Z', 'projects': [{'repo': 'private-401-context', 'label': 'Private fixture',
               'lifecycle': 'active', 'ci': {'state': 'passing', 'workflow': 'private-check'},
               'stars': 0, 'forks': 0, 'openIssuesAndPullRequests': 1}]}
    await page.locator('#import-commitatlas').set_input_files({'name': 'projects.json', 'mimeType': 'application/json',
                                                           'buffer': json.dumps(catalog).encode()})
    await expect(page.locator('#import-dialog')).to_be_visible()
    await page.locator('#accept-import').click()
    await expect(page.locator('#view')).to_contain_text('example-builder/private-401-context')
    await page.locator('[data-view=usage]').click()
    await expect(page.get_by_role('region', name='Alibi usage summary')).to_be_visible()
    # Statistics-specific 401 clears the usage view, token and independently populated imported context.
    await page.evaluate('window.usageStatus = 401')
    await page.locator('#usage-window').select_option('7')
    await expect(page.locator('#mode')).to_have_text('NOT CONNECTED')
    await expect(page.get_by_role('region', name='Alibi usage summary')).to_have_count(0)
    await expect(page.locator('#token')).to_have_value('')
    if not offline:
        assert await page.evaluate("localStorage.getItem('pulseboard.desk.token')") is None
    await expect(page.locator('#toast')).to_contain_text('Read token rejected')
    await page.locator('[data-view=connections]').click()
    await expect(page.locator('#page-title')).to_have_text('Connections')
    await expect(page.locator('#view')).not_to_contain_text('example-builder/private-401-context')
    await expect(page.locator('#import-preview')).to_have_text('')


async def run(args):
    checks = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path=args.chromium or None)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1100}, reduced_motion='reduce')
        await context.add_init_script("window.cspViolations = []; document.addEventListener('securitypolicyviolation', e => window.cspViolations.push(e.violatedDirective))")
        page = await context.new_page()
        errors, requests, console_errors = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
        if args.offline:
            await page.set_content(DESK.offline_html(), wait_until='load')
        else:
            await page.goto(args.origin, wait_until='networkidle')
        await page.locator('#demo').click()
        await expect(page.locator('#mode')).to_have_text('SYNTHETIC DEMO')
        for name, check in [('focus', check_focus), ('navigation', check_navigation), ('filter', check_filter)]:
            if args.case in ('all', name):
                await check(page)
                checks.append(name)
        assert not any('/v1/' in url for url in requests), 'These sample-only checks must not read or write collector data'
        if args.case in ('all', 'usage'):
            await check_usage(page, args.offline)
            checks.append('usage: sandbox, latest window wins, statistics 401' + ('' if args.offline else ', real protected SQLite read'))
        assert not errors, errors
        assert not console_errors, console_errors
        if not args.offline:
            assert await page.evaluate('window.cspViolations') == []
        print(json.dumps({'transport': 'offline inlined assets' if args.offline else 'real HTTP assets',
                          'checks': checks, 'pageErrors': errors, 'consoleErrors': console_errors}, indent=2))
        await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--offline', action='store_true')
    parser.add_argument('--origin', default='http://127.0.0.1:8788')
    parser.add_argument('--chromium', default=os.environ.get('PULSEBOARD_CHROMIUM'))
    parser.add_argument('--case', choices=['all', 'focus', 'navigation', 'filter', 'usage'], default='all')
    asyncio.run(run(parser.parse_args()))
