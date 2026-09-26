---
paths:
  - "legacy/**"
---

# Workbench region (FastAPI + Vue feed dashboard)

Loads by path only. The root `CLAUDE.md` owns run/prove commands and authority; this file is the
architecture map for the frozen legacy runtime under `legacy/` (moved 2026-09-26);
`legacy/WORKBENCH.md` is its user README and `legacy/README.md` its status note.

## Data flow

1. `FeedManager` (`legacy/backend/app/feeds/manager.py`) loads enabled `FeedDefinition` rows at startup
   and starts one asyncio task per feed; `BaseFeed.run()` calls `fetch_data()` every `interval_sec`.
2. `DataHub` (`legacy/backend/app/hub/hub.py`) receives `publish_feed_event()`, keeps `latest` plus a
   10-minute `history` deque per feed, and broadcasts only to dashboards that use that feed
   (`dashboard_feeds`). New WebSocket clients get the latest events as initial state.
3. `legacy/backend/app/ws/router.py` serves `/ws/dashboards/{id}`: reads the dashboard's panels, extracts
   feed IDs, registers with the hub. Keepalive ping every 30 s comes from the frontend.
4. `useDashboardWebSocket.ts` reconnects with exponential backoff, max 5 attempts; after that the
   `ConnectionStatus` "Retry Connection" button calls `manualReconnect()`. Events land in
   `liveDataStore` (latest + last 100 per feed); panels render from it.

## Models and config

- `Dashboard` → `Panel` (one-to-many). A panel stores `feed_ids_json` (JSON array of feed-id
  strings, parsed in `ws/router.py`) and `options_json` (panel options; `DashboardLiveView.vue`
  passes both as `feed-ids` / `options` props, `PanelDialog.vue` writes them). Only `FeedDefinition`
  has a `config_json` column (feed-specific settings such as `interval_sec`); all three are JSON
  strings — parse with `json.loads`. There is no `feed_key` anywhere in the code.
- Feed registry: `get_feed_class(type)` in `legacy/backend/app/feeds/__init__.py`; add a feed by subclassing
  `BaseFeed`, registering it there, then creating a `FeedDefinition` via `POST /api/feeds`.
- Backend `.env`: `DATABASE_URL` (default `sqlite:///./pulseboard.db`), `CORS_ORIGINS`,
  `HISTORY_WINDOW_MINUTES`, `LOG_LEVEL`. Frontend: `VITE_API_BASE_URL` (Vite proxy in dev).
- REST: `/api/dashboards`, `/api/feeds`, `/api/dashboards/{id}/panels`, `/api/panels/{id}`,
  `/health`. Docker: `legacy/docker-compose.yml` (prod) and `legacy/docker-compose.dev.yml` (hot reload) —
  Docker Desktop is not installed on Kraspyon, so those paths are hosted-only here.

## Pitfalls that already cost a session

- Feeds must re-check `self._running` / `self._stop_requested` after every `await`, or shutdown hangs.
- Chart panels expect numeric payload values; a string payload renders an empty ECharts panel.
- Every workbench gate is green since #50–#61 (2026-09-22): backend tests, ruff and mypy clean, 64 frontend
  tests, build and budget, `npm audit` 0. A red result is a regression, not a baseline.
