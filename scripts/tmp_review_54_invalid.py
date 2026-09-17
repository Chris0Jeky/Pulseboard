from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
worker = root / 'observatory/src/worker.mjs'
text = worker.read_text(encoding='utf-8')
old = """      const admission = collectionAdmission(env);
      return json(await readPortfolio(env.DB, { days: Number(value), collectionEnabled: admission.enabled, admittedProjects: admission.admitted }));
"""
new = """      const admission = collectionAdmission(env);
      if (!admission.valid) return json({ error: 'invalid_collection_configuration', invalid: admission.invalid }, 503);
      return json(await readPortfolio(env.DB, { days: Number(value), collectionEnabled: admission.enabled, admittedProjects: admission.admitted }));
"""
if text.count(old) != 1:
    raise SystemExit(f'portfolio admission anchor count: {text.count(old)}')
worker.write_text(text.replace(old, new), encoding='utf-8')

for command in (
    ['npm', 'test'],
    ['node', '--check', 'src/worker.mjs'],
    ['npx', 'wrangler', 'deploy', '--dry-run'],
):
    subprocess.run(command, cwd=root / 'observatory', check=True)
subprocess.run(['git', 'diff', '--check'], cwd=root, check=True)

(root / '.github/workflows/tmp-review-54-invalid.yml').unlink()
Path(__file__).unlink()
subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=root, check=True)
subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=root, check=True)
subprocess.run(['git', 'add', '-A'], cwd=root, check=True)
subprocess.run(['git', 'commit', '-m', 'Reject portfolio reads for invalid admission'], cwd=root, check=True)
subprocess.run(['git', 'push', 'origin', 'HEAD:fix/project-admission-contract-46'], cwd=root, check=True)
