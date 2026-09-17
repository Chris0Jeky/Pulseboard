from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / 'observatory/public/desk-bridge.mjs'
TEST = ROOT / 'observatory/tests/alibi-journey.test.mjs'

bridge = BRIDGE.read_text(encoding='utf-8')
integer_anchor = "const integer = value => { requireValue(Number.isSafeInteger(value) && value >= 0, 'Invalid count'); return value; };\n"
helper = r"""const namedJourney = value => {
  if (value === null) return;
  requireValue(plain(value), 'Invalid named journey');
  exactKeys(value, ['schema', 'id', 'label', 'attempts', 'outcomes', 'hints', 'completion', 'limitations']);
  requireValue(value.schema === 'pulseboard.named-journey/1' && /^[a-z0-9-]{1,40}$/.test(boundedString(value.id, 40)), 'Invalid named journey identity');
  boundedString(value.label, 80);
  exactKeys(value.attempts, ['initial', 'retries', 'total']);
  const initial = integer(value.attempts.initial), retries = integer(value.attempts.retries), attempts = integer(value.attempts.total);
  requireValue(attempts === initial + retries, 'Invalid named journey attempts');
  exactKeys(value.outcomes, ['completed', 'failed', 'open', 'orphaned']);
  const completed = integer(value.outcomes.completed), failed = integer(value.outcomes.failed);
  const open = integer(value.outcomes.open), orphaned = integer(value.outcomes.orphaned);
  requireValue(completed + failed + open === attempts + orphaned, 'Invalid named journey outcomes');
  integer(value.hints);
  exactKeys(value.completion, ['numerator', 'denominator', 'value', 'interval']);
  requireValue(integer(value.completion.numerator) === completed && integer(value.completion.denominator) === attempts, 'Invalid named journey fraction');
  if (orphaned > 0 || attempts === 0) requireValue(value.completion.value === null && value.completion.interval === null, 'Invalid abstaining journey fraction');
  else {
    requireValue(Number.isFinite(value.completion.value) && Math.abs(value.completion.value - completed / attempts) < 1e-12, 'Invalid named journey fraction');
    requireValue(Array.isArray(value.completion.interval) && value.completion.interval.length === 2
      && value.completion.interval.every(bound => Number.isFinite(bound) && bound >= 0 && bound <= 1)
      && value.completion.interval[0] <= value.completion.interval[1], 'Invalid named journey interval');
  }
  const limitations = list(value.limitations, 8); requireValue(limitations.length > 0, 'Named journey limitations required');
  limitations.forEach(item => boundedString(item, 500));
};
"""
if helper not in bridge:
    if bridge.count(integer_anchor) != 1:
        raise SystemExit('bridge integer anchor missing')
    bridge = bridge.replace(integer_anchor, integer_anchor + helper)
call_anchor = """    for (const f of [p.flow, p.probeSamples]) {
      requireValue(plain(f), 'Missing fraction'); integer(f.numerator); integer(f.denominator);
      requireValue(f.numerator <= f.denominator && (f.denominator ? Number.isFinite(f.value) && Math.abs(f.value - f.numerator / f.denominator) < 1e-12 : f.value === null), 'Invalid fraction');
    }
    requireValue(plain(p.budget), 'Missing budget');"""
call_replacement = call_anchor.replace("    requireValue(plain(p.budget), 'Missing budget');", "    namedJourney(p.journey);\n    requireValue(plain(p.budget), 'Missing budget');")
if call_replacement not in bridge:
    if bridge.count(call_anchor) != 1:
        raise SystemExit('bridge journey call anchor missing')
    bridge = bridge.replace(call_anchor, call_replacement)
BRIDGE.write_text(bridge, encoding='utf-8')

test = TEST.read_text(encoding='utf-8')
test_anchor = "  assert.equal(assertPortfolio(snapshot), snapshot);\n  const alibi = snapshot.projects.find(project => project.id === 'alibi');\n"
test_replacement = """  assert.equal(assertPortfolio(snapshot), snapshot);
  const malformed = structuredClone(snapshot);
  malformed.projects.find(project => project.id === 'alibi').journey.attempts.total = 99;
  assert.throws(() => assertPortfolio(malformed), /named journey attempts/i);
  const alibi = snapshot.projects.find(project => project.id === 'alibi');
"""
if test_replacement not in test:
    if test.count(test_anchor) != 1:
        raise SystemExit('journey validation test anchor missing')
    test = test.replace(test_anchor, test_replacement)
TEST.write_text(test, encoding='utf-8')

for command in (
    ['node', '--test', 'tests/alibi-journey.test.mjs'],
    ['npm', 'test'],
    ['node', '--check', 'adapters/alibi-journey.mjs'],
    ['node', '--check', 'adapters/build-embed.mjs'],
    ['node', '--check', 'src/portfolio.mjs'],
    ['node', '--check', 'public/desk-model.mjs'],
    ['node', '--check', 'public/desk-bridge.mjs'],
    ['npx', 'wrangler', 'deploy', '--dry-run'],
):
    subprocess.run(command, cwd=ROOT / 'observatory', check=True)
subprocess.run(['git', 'diff', '--check'], cwd=ROOT, check=True)

workflow = ROOT / '.github/workflows/tmp-alibi-journey-18.yml'
if workflow.exists(): workflow.unlink()
Path(__file__).unlink()
subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=ROOT, check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=ROOT, check=True)
subprocess.run(['git', 'add', '-A'], cwd=ROOT, check=True)
subprocess.run(['git', 'commit', '-m', 'Validate named journey evidence'], cwd=ROOT, check=True)
subprocess.run(['git', 'push', 'origin', 'HEAD:feat/alibi-journey-contract-18'], cwd=ROOT, check=True)
