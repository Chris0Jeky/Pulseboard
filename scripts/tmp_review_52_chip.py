from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]

def replace_once(relative, old, new):
    path = root / relative
    text = path.read_text(encoding='utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{relative}: expected one match, found {text.count(old)}')
    path.write_text(text.replace(old, new), encoding='utf-8')

replace_once('observatory/public/desk-model.mjs',
"""export function monitorState(project, now) {
  if (!project.probeExpected) return 'local';
  if (!Number.isFinite(project.monitor.checked)) return 'unknown';
  if (project.monitor.checked > now || now - project.monitor.checked > STALE_AFTER) return 'stale';
  return ['up', 'down', 'unknown'].includes(project.monitor.state) ? project.monitor.state : 'unknown';
}
""",
"""export function monitorState(project, now) {
  if (!project.probeExpected) return 'local';
  if (!Number.isFinite(project.monitor.checked)) return 'unknown';
  if (project.monitor.checked > now || now - project.monitor.checked > STALE_AFTER) return 'stale';
  return ['up', 'down', 'unknown'].includes(project.monitor.state) ? project.monitor.state : 'unknown';
}
/** Keep recorded state and reading freshness separate while a live refresh is unavailable. */
export function monitorDisplay(project, now, refreshFailed = false) {
  const freshness = monitorState(project, now);
  if (refreshFailed && project.probeExpected) {
    if (project.monitor?.state === 'down') return { state: 'down', freshness, lastKnown: true };
    return { state: 'stale', freshness, lastKnown: false };
  }
  return { state: freshness, freshness, lastKnown: false };
}
""")
replace_once('observatory/public/dashboard.mjs',
"import { DAY, sum, count, percent, fraction, monitorState, buildSignals, compareReleases, reviewState, makeBrief, makeHandoff } from './desk-model.mjs';",
"import { DAY, sum, count, percent, fraction, monitorState, monitorDisplay, buildSignals, compareReleases, reviewState, makeBrief, makeHandoff } from './desk-model.mjs';")
replace_once('observatory/public/dashboard.mjs',
"""function chip(p) {
  const s = monitorState(p, Date.now()), unread = state.stale && state.snapshot?.mode === 'live' && p.probeExpected;
  if (unread && s === 'down') return e('span', { class: 'state-chip down last-known' }, `${labels.down} · last known`);
  return unread ? e('span', { class: 'state-chip stale' }, 'Reading unknown') : e('span', { class: `state-chip ${s}` }, labels[s]);
}
""",
"""function chip(p) {
  const failedRefresh = state.stale && state.snapshot?.mode === 'live';
  const display = monitorDisplay(p, Date.now(), failedRefresh);
  if (display.lastKnown) {
    const age = display.freshness === 'stale' ? ' · old reading' : '';
    return e('span', { class: 'state-chip down last-known' }, `${labels.down} · last known${age}`);
  }
  return failedRefresh && p.probeExpected ? e('span', { class: 'state-chip stale' }, 'Reading unknown')
    : e('span', { class: `state-chip ${display.state}` }, labels[display.state]);
}
""")

for command in (
    ['npm', 'test'],
    ['node', '--check', 'public/desk-model.mjs'],
    ['node', '--check', 'public/dashboard.mjs'],
    ['npx', 'wrangler', 'deploy', '--dry-run'],
):
    subprocess.run(command, cwd=root / 'observatory', check=True)
subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)

(root / '.github/workflows/tmp-review-52-chip.yml').unlink()
Path(__file__).unlink()
subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=root, check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=root, check=True)
subprocess.run(['git', 'add', '-A'], cwd=root, check=True)
subprocess.run(['git', 'commit', '-m', 'Keep aged failures visible in project status'], cwd=root, check=True)
subprocess.run(['git', 'push', 'origin', 'HEAD:fix/desk-refresh-state-33'], cwd=root, check=True)
