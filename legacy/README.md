# Legacy feed workbench

This directory holds Pulseboard's original runtime: a FastAPI backend (`backend/`) and a Vue 3
frontend (`frontend/pulseboard-web/`) that stream pluggable feeds over WebSockets into ECharts
panels. It is frozen: it gets no new features, but it keeps building and stays green in CI
(`workbench-backend.yml`, `workbench-frontend.yml`, `python-package.yml`). The primary direction
is the Desk in [`../observatory/`](../observatory/README.md). It moved here on 2026-09-26 by owner
decision; nothing was deleted, and [WORKBENCH.md](WORKBENCH.md) keeps its original user guide,
with every command run from this directory. `STATUS.md`, `DEMO_GUIDE.md`,
`IMPROVEMENT_PROPOSALS.md` and `UI_IMPROVEMENTS.md` are 2025-11 history, not verification.

To run and test it from `legacy/`: create a virtual environment with `python -m venv venv`,
install `backend/requirements.txt` into it, then from `backend/` run
`python -m pytest -q -p no:cacheprovider`, `python -m ruff check app` and `python -m mypy app`,
or start it with `python -m uvicorn app.main:app --reload --port 8000`. For the frontend, from
`frontend/pulseboard-web/` run `npm ci`, `npx vitest run --maxWorkers=2`, `npm run build` and
`npm run build:budget`, or `npm run dev` for http://localhost:5173. Docker users run the compose
files and `scripts/` from this directory ([DOCKER.md](DOCKER.md)). The workbench's feed pattern
(`backend/app/feeds/`: `BaseFeed`, registry, manager) is the model for the Desk's bounded evidence
adapters (#24).
