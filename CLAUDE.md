# Pulseboard — agent map

Pulseboard is a public GPL-3.0-only repository carrying two runtimes side by side. The
**workbench** on `main` is a FastAPI + Vue 3 real-time feed dashboard (pluggable feeds →
WebSocket → ECharts panels). The **Desk** in `observatory/` is the new primary direction: a
dependency-free Node collector, an aggregate read model and an operations desk, with collection
disabled by default. The Desk landed on `main` on 2026-09-10 through PRs #15 → #16 → #17 after a
three-region adversarial review and fix round; issues #18–#24 are its delivery order, the seven
host-repo PRs carry regenerated inert artifacts (#31), and #32/#33 hold the tracked low findings. `AGENTS.md` is the thin Codex
adapter of this file; `WORKBENCH.md` is the legacy runtime's user README.

## Run it (Kraspyon, measured 2026-09-10: Python 3.13, Node 24.19, no Docker Desktop)

- Workbench backend: `python -m venv venv && venv/Scripts/python -m pip install -r backend/requirements.txt`,
  then `cd backend && ../venv/Scripts/python -m uvicorn app.main:app --reload --port 8000`.
- Workbench frontend: `cd frontend/pulseboard-web && npm ci && npm run dev` → http://localhost:5173.
- Desk: `cd observatory && npm start` → http://127.0.0.1:8788; the read token is printed only when generated
  (set `READ_TOKEN`, at least 32 characters, to supply your own).

## Prove it — narrowest check per seam

| Seam | Command from the repo root | Measured 2026-09-10 |
|---|---|---|
| `backend/**` | `cd backend && ../venv/Scripts/python -m pytest -q -p no:cacheprovider` | 67 passed, 9 s |
| backend lint/types | `cd backend && ../venv/Scripts/python -m ruff check app` and `-m mypy app` | clean since #58 (2026-09-22, Linux, Python 3.11) |
| `frontend/**` | `cd frontend/pulseboard-web && npx vitest run --maxWorkers=2` | 64 passed, 4 s; `npm audit --audit-level=low` 0 findings (#57, #59; 2026-09-22) |
| frontend build | `cd frontend/pulseboard-web && npm run build && npm run build:budget` | passes, budget verified (#57, #61; 2026-09-22) |
| `observatory/**` | `cd observatory && npm test` | 216 passed, under 2 s; CRLF-safe since #15 (#25 was line endings, not Node 24) |
| Desk browser | once: `python -m venv .browser-venv && .browser-venv/Scripts/pip install playwright==1.57.0 && .browser-venv/Scripts/playwright install chromium`; then, with `READ_TOKEN` exported in the foreground shell, `cd observatory && node src/local.mjs` in one shell and `cd observatory && ../.browser-venv/Scripts/python tests/desk-browser.py --origin http://127.0.0.1:8788` in another | 15 checks passed; `kill` does not stop node.exe here, free port 8788 via PowerShell `Stop-Process` |
| Desk hosted | `cd observatory && npx wrangler deploy --dry-run`; admission gate on a preview: `npx wrangler deploy --env preview` then `node tests/hosted-admission.mjs --origin <preview> --project mdviewer --events 1 --expect 202 --repeat` (delete the preview after) | 2026-09-10: 202/202, one event row; 429 on both budget branches |
| docs and harness | `git diff --check` (working tree) and `git diff --check origin/main...HEAD` (review range; `--cached` for staged); `python <agent-harness>/harness.py audit .` | clean |

Every gate above was green on `main` on 2026-09-22 (#13 and #14 closed by #50, #57, #58, #59, #61). A change
that touches a seam must not move its numbers the wrong way. CI: `observatory.yml` (Node 22, `npm test`) and
`desk-browser.yml` (Playwright against the real server) run on PRs and `main` pushes that touch `observatory/**`;
`workbench-backend.yml`, `workbench-frontend.yml` and `python-package.yml` gate the workbench and packaging;
`collector-canary.yml` checks the hosted collector twice an hour from GitHub's runners. `main` has no branch protection (measured 2026-09-10). Squash merge is disabled
repo-side; merge with a merge commit.

## Map

- `backend/app/` — FastAPI: `feeds/` (BaseFeed + registry), `hub/` (DataHub latest + history,
  per-dashboard broadcast), `ws/` (`/ws/dashboards/{id}`), `models/` (SQLModel), `api/`.
- `frontend/pulseboard-web/src/` — Pinia stores (`dashboards`, `liveData`, `ui`), the
  `useDashboardWebSocket` composable, `components/panels/*.vue` (ECharts).
- `observatory/` — `src/` collector, worker, sqlite, portfolio, contracts; `public/` the Desk
  UI (native ESM, no build step); `adapters/` embed installer; `docs/DESK_*.md` architecture,
  bridges and direction; `tests/*.test.mjs` plus `tests/desk-browser.py`.
- Alibi release sync: `cd observatory && npm run sync:alibi` finds one Alibi checkout beside
  Pulseboard; `ALIBI_REPO` or a positional path selects another. It validates Alibi's package and
  release records, updates the shared release contract, and refreshes the locked host adapter.
  `npm run check:alibi` checks without writing. Both commands support `--json`; a daily
  read-only Actions watch reports drift against public Alibi `main`. See
  `observatory/docs/DESK_BRIDGES.md`.
- Workbench architecture detail loads by path from `.claude/rules/workbench.md`.

## Desk boundaries

Collection is admitted only for the ids in `COLLECT_PROJECTS`: never add one, deploy a Worker, broaden probe targets or publish a
private projection as incidental cleanup. Closed versioned contracts, bounded payloads, explicit
missingness and source times; never average percentiles; demo fixtures never reach collector
storage. Imported claims never become verified CI, user identity, public health or causality by
relabelling. Read `observatory/docs/DESK_ARCHITECTURE.md` and `DESK_BRIDGES.md` before changing a
measurement or data boundary. Prefer a tested vertical slice to scaffolding.

## Pitfalls

- `git show <ref>:path/with/slashes` under the Bash tool needs `MSYS_NO_PATHCONV=1`, or the path is mangled.
- `venv/`, `node_modules/` and `*.db` are gitignored and absent in a fresh worktree; install before proving.
- `observatory/` is `eol=lf` by `.gitattributes`; the rest of the tree is not, so builders that read
  sources must normalise line endings (the embed builder does since #15).
- Paths above are Windows (`venv/Scripts/python`); on Linux or macOS, including Codex cloud, use `venv/bin/python`.
- The frontend audit is clean since #59 and CI enforces it; triage any new finding individually, never `audit fix --force`.
- `STATUS.md`, `DEMO_GUIDE.md`, `IMPROVEMENT_PROPOSALS.md` and `UI_IMPROVEMENTS.md` describe the
  2025-11 workbench and are history, not verification.

## Authority

Codex setup: `scripts/agent/context.ps1` reads the current map and decisions;
`scripts/agent/check.ps1` proves the Desk and harness (Windows: `powershell -NoProfile
-ExecutionPolicy Bypass -File <script>`). The shared adapter is `.codex/hooks.json`; new-session
`/hooks` trust remains a human check. Deployment commands and receipts: `observatory/docs/HOSTING.md`.

T2 daily driver, `push: free`, `merge: free` within the global gate; `.agent-harness/tier.json`
binds; the owner ratified T2 on 2026-09-10 (q-1). Human-action file: `HUMAN_TODO.md`; read it before
merging anything. Hosted Cloudflare/D1 activation (q-2) and the Desk stack merge (q-3) were both
authorised on 2026-09-10; q-3 carries the owner's condition that #15–#17 get a deep check and test
pass first. Cloudflare access is verified (q-4). The Desk is hosted with collection on for Alibi only (below) and a 15-minute
probe cron registered over the seven origins; the handler is proven on the edge but no unattended tick
had been observed by 2026-09-10 16:00Z because of Cloudflare incident sjs8s0q2x4hw (#43 confirms the
first tick once it resolves; `observatory/docs/HOSTING.md`). The scratch-D1 admission
gate passed the same day. Collection is on for Alibi only since the owner chose it as the first pilot and approved
its notice (q-7, 2026-09-10): `COLLECT_PROJECTS` in `wrangler.jsonc` lists the admitted ids and every other
host artifact keeps an empty endpoint; adding a host there is a new owner decision, not cleanup. Global laws are auto-loaded; nothing here restates them.
