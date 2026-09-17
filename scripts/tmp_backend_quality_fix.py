from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"


def run(*args: str) -> None:
    subprocess.run(args, cwd=BACKEND, check=True)


run("python", "-m", "ruff", "check", "app", "--fix")
run("python", "-m", "pytest", "-q", "-p", "no:cacheprovider")
run("python", "-m", "ruff", "check", "app")
run("python", "-m", "mypy", "app")
subprocess.run(["git", "diff", "--check"], cwd=ROOT, check=True)

(ROOT / ".github/workflows/tmp-backend-quality-fix.yml").unlink()
Path(__file__).unlink()
subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=ROOT, check=True)
subprocess.run(
    ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
    cwd=ROOT,
    check=True,
)
subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
subprocess.run(["git", "commit", "-m", "Restore backend lint and type gates"], cwd=ROOT, check=True)
subprocess.run(["git", "push", "origin", "HEAD:fix/backend-gates-13"], cwd=ROOT, check=True)
