from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
path = root / 'observatory/public/desk-bridge.mjs'
text = path.read_text(encoding='utf-8')
old = """    for (const f of [p.flow, p.probeSamples]) {
      requireValue(plain(f), 'Missing fraction'); integer(f.numerator); integer(f.denominator);
      requireValue(f.numerator <= f.denominator && (f.denominator ? Number.isFinite(f.value) && Math.abs(f.value - f.numerator / f.denominator) < 1e-12 : f.value === null), 'Invalid fraction');
    }
    requireValue(plain(p.budget), 'Missing budget'); integer(p.budget.used); integer(p.budget.limit); boundedString(p.budget.day, 10);
"""
new = """    for (const f of [p.flow, p.probeSamples]) {
      requireValue(plain(f), 'Missing fraction'); integer(f.numerator); integer(f.denominator);
      requireValue(f.numerator <= f.denominator && (f.denominator ? Number.isFinite(f.value) && Math.abs(f.value - f.numerator / f.denominator) < 1e-12 : f.value === null), 'Invalid fraction');
    }
    const operations = p.operations === undefined ? [] : list(p.operations, 16);
    unique(operations.map(operation => operation.id));
    for (const operation of operations) {
      exactKeys(operation, ['id', 'version', 'attempts', 'completed', 'failed', 'open', 'retries', 'completion', 'releases']);
      requireValue(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(boundedString(operation.id, 80)) && operation.version === 1,
        'Invalid operation identity or version');
      for (const key of ['attempts', 'completed', 'failed', 'open', 'retries']) integer(operation[key]);
      requireValue(operation.completed + operation.failed + operation.open === operation.attempts
        && operation.retries <= operation.attempts, 'Invalid operation totals');
      const completion = operation.completion;
      requireValue(plain(completion), 'Missing operation completion fraction');
      integer(completion.numerator); integer(completion.denominator);
      requireValue(completion.numerator === operation.completed && completion.denominator === operation.attempts
        && (completion.denominator ? Number.isFinite(completion.value)
          && Math.abs(completion.value - completion.numerator / completion.denominator) < 1e-12 : completion.value === null),
        'Invalid operation completion fraction');
      const operationReleases = list(operation.releases, 64);
      unique(operationReleases.map(row => row.release));
      for (const row of operationReleases) {
        exactKeys(row, ['release', 'attempts', 'completed', 'failed', 'open', 'retries']);
        boundedString(row.release, 160);
        for (const key of ['attempts', 'completed', 'failed', 'open', 'retries']) integer(row[key]);
        requireValue(row.completed + row.failed + row.open === row.attempts && row.retries <= row.attempts,
          'Invalid operation release totals');
      }
      for (const key of ['attempts', 'completed', 'failed', 'open', 'retries']) {
        requireValue(operationReleases.reduce((total, row) => total + row[key], 0) === operation[key],
          'Operation release totals do not reconcile');
      }
    }
    requireValue(plain(p.budget), 'Missing budget'); integer(p.budget.used); integer(p.budget.limit); boundedString(p.budget.day, 10);
"""
if text.count(old) != 1:
    raise SystemExit(f'bridge operation validation anchor count: {text.count(old)}')
path.write_text(text.replace(old, new), encoding='utf-8')

for command in (
    ['npm', 'test'],
    ['node', '--check', 'public/desk-bridge.mjs'],
    ['node', '--check', 'src/portfolio.mjs'],
    ['npx', 'wrangler', 'deploy', '--dry-run'],
):
    subprocess.run(command, cwd=root / 'observatory', check=True)
subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)

(root / '.github/workflows/tmp-patch-63.yml').unlink()
Path(__file__).unlink()
subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=root, check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=root, check=True)
subprocess.run(['git', 'add', '-A'], cwd=root, check=True)
subprocess.run(['git', 'commit', '-m', 'Validate named operation aggregates'], cwd=root, check=True)
subprocess.run(['git', 'push', 'origin', 'HEAD:feat/alibi-journey-18'], cwd=root, check=True)
