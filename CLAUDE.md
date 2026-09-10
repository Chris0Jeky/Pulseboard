# Pulseboard — agent map

Pulseboard is a public GPL-3.0-only repository carrying two runtimes side by side. The
**workbench** on `main` is a FastAPI + Vue 3 real-time feed dashboard (pluggable feeds →
WebSocket → ECharts panels). The **Desk** in `observatory/` is the new primary direction: a
dependency-free Node collector, an aggregate read model and an operations desk, with collection
disabled by default. As of 2026-09-10 the Desk exists only on the stacked PRs #15 → #16 → #17
(`feat/portfolio-observatory-kit` → `feat/pulseboard-desk` → `feat/pulseboard-desk-ui`); issues
#18–#24 are its delivery order and every one of them depends on that stack. Whether the stack
merges at all is the owner's call (HUMAN_TODO q-3); once authorised, merge it oldest-first and
retarget each child after its base lands (#27 tracks the post-merge doc sync).

## Run it (Kraspyon, measured 2026-09-10: Python 3.13, Node 24.19, no Docker Desktop)

- Workbench backend: `python -m venv venv && venv/Scripts/python -m pip install -r backend/requirements.txt`,
  then `cd backend && ../venv/Scripts/python -m uvicorn app.main:app --reload --port 8000`.
- Workbench frontend: `cd frontend/pulseboard-web && npm ci && npm run dev` → http://localhost:5173.
- Desk (stack only): `cd observatory && npm start` → http://127.0.0.1:8788, read token printed to the terminal.

## Prove it — narrowest check per seam

| Seam | Command from the repo root | Measured 2026-09-10 |
|---|---|---|
| `backend/**` | `cd backend && ../venv/Scripts/python -m pytest -q -p no:cacheprovider` | 67 passed, 9 s |
| backend lint/types | `cd backend && ../venv/Scripts/python -m ruff check app` and `-m mypy app` | 19 and 9 errors, pre-existing (#13) |
| `frontend/**` | `cd frontend/pulseboard-web && npx vitest run --maxWorkers=2` | 56 passed, 2 failed, pre-existing (#13), 17 s |
| frontend build | `cd frontend/pulseboard-web && npm run build` | fails: Tailwind `theme.css` missing (#13) |
| `observatory/**` | `cd observatory && npm test` | 94/96 on Node 24 here (#25); 96/96 in CI on Node 22 |
| Desk browser | `.github/workflows/desk-browser.yml`, Playwright against the real server | hosted-only; local runs need a Playwright venv |
| docs and harness | `git diff --check origin/main...HEAD` (add `--cached` for staged work); `python <agent-harness>/harness.py audit .` | clean |

The red gates above are tracked debt (#13 lint/types/tests/build, #14 setuptools floor). A change
that touches a seam must not move its numbers the wrong way, and a green Desk run never closes
#13 or #14. CI on the stack: `observatory.yml` (Node 22, `npm test`) and `desk-browser.yml` run
only for `observatory/**` changes. `main` has no branch protection and no workflow (measured
2026-09-10). Squash merge is disabled repo-side; merge with a merge commit.

## Map

- `backend/app/` — FastAPI: `feeds/` (BaseFeed + registry), `hub/` (DataHub latest + history,
  per-dashboard broadcast), `ws/` (`/ws/dashboards/{id}`), `models/` (SQLModel), `api/`.
- `frontend/pulseboard-web/src/` — Pinia stores (`dashboards`, `liveData`, `ui`), the
  `useDashboardWebSocket` composable, `components/panels/*.vue` (ECharts).
- `observatory/` (stack) — `src/` collector, worker, sqlite, portfolio, contracts; `public/` the Desk
  UI (native ESM, no build step); `adapters/` embed installer; `docs/DESK_*.md` architecture,
  bridges and direction; `tests/*.test.mjs` plus `tests/desk-browser.py`.
- Workbench architecture detail loads by path from `.claude/rules/workbench.md`.

## Desk boundaries

Collection stays disabled: never enable it, deploy a Worker, broaden probe targets or publish a
private projection as incidental cleanup. Closed versioned contracts, bounded payloads, explicit
missingness and source times; never average percentiles; demo fixtures never reach collector
storage. Imported claims never become verified CI, user identity, public health or causality by
relabelling. Read `observatory/docs/DESK_ARCHITECTURE.md` and `DESK_BRIDGES.md` before changing a
measurement or data boundary. Prefer a tested vertical slice to scaffolding.

## Pitfalls

- `git show <ref>:path/with/slashes` under the Bash tool needs `MSYS_NO_PATHCONV=1`, or the path is mangled.
- `venv/`, `node_modules/` and `*.db` are gitignored and absent in a fresh worktree; install before proving.
- `npm ci` in the frontend reports 27 audit findings (#13); triage individually, never `audit fix --force`.
- `STATUS.md`, `DEMO_GUIDE.md`, `IMPROVEMENT_PROPOSALS.md` and `UI_IMPROVEMENTS.md` describe the
  2025-11 workbench and are history, not verification.
- `.vite/deps` is a tracked build cache on `main` (#26); do not read or "fix" it in passing.

## Authority

T2 daily driver, `push: free`, `merge: free` within the global gate; `.agent-harness/tier.json`
binds and its ratification is open as q-1. Human-action file: `HUMAN_TODO.md`; read it before
merging anything. Three gates are the owner's alone: ratifying the tier (q-1), any hosted
Cloudflare/D1 resource, production read token or collection activation (q-2), and merging the Desk
stack #15–#17 (q-3). Global laws are auto-loaded; nothing here restates them.
