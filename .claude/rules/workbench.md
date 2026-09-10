---
paths:
  - "backend/**"
  - "frontend/**"
  - "scripts/**"
  - "docker-compose*.yml"
---

# Workbench region (FastAPI + Vue feed dashboard)

Loads by path only. The root `CLAUDE.md` owns run/prove commands and authority; this file is the
architecture map for the legacy runtime. `WORKBENCH.md` (arrives with #17) is its user README.

## Data flow

1. `FeedManager` (`backend/app/feeds/manager.py`) loads enabled `FeedDefinition` rows at startup
   and starts one asyncio task per feed; `BaseFeed.run()` calls `fetch_data()` every `interval_sec`.
2. `DataHub` (`backend/app/hub/hub.py`) receives `publish_feed_event()`, keeps `latest` plus a
   10-minute `history` deque per feed, and broadcasts only to dashboards that use that feed
   (`dashboard_feeds`). New WebSocket clients get the latest events as initial state.
3. `backend/app/ws/router.py` serves `/ws/dashboards/{id}`: reads the dashboard's panels, extracts
   feed IDs, registers with the hub. Keepalive ping every 30 s comes from the frontend.
4. `useDashboardWebSocket.ts` reconnects with exponential backoff, max 5 attempts, then the user must
   refresh. Events land in `liveDataStore` (latest + last 100 per feed); panels render from it.

## Models and config

- `Dashboard` → `Panel` (one-to-many); `FeedDefinition` is referenced from `Panel.config_json`
  (`feed_id`, `feed_key` dot path into the payload). `config_json` columns are JSON strings — parse
  with `json.loads`.
- Feed registry: `get_feed_class(type)` in `backend/app/feeds/__init__.py`; add a feed by subclassing
  `BaseFeed`, registering it there, then creating a `FeedDefinition` via `POST /api/feeds`.
- Backend `.env`: `DATABASE_URL` (default `sqlite:///./pulseboard.db`), `CORS_ORIGINS`,
  `HISTORY_WINDOW_MINUTES`, `LOG_LEVEL`. Frontend: `VITE_API_BASE_URL` (Vite proxy in dev).
- REST: `/api/dashboards`, `/api/feeds`, `/api/dashboards/{id}/panels`, `/api/panels/{id}`,
  `/health`. Docker: `docker-compose.yml` (prod) and `docker-compose.dev.yml` (hot reload) —
  Docker Desktop is not installed on Kraspyon, so those paths are hosted-only here.

## Pitfalls that already cost a session

- Feeds must re-check `self._running` / `self._stop_requested` after every `await`, or shutdown hangs.
- Panels assume numeric values at `feed_key`; a string payload renders an empty ECharts panel.
- Frontend tests fail on `updateDashboard` and `liveData.clear` because the stores lack them (#13):
  a green run on a store change is 56/58, not 58/58, until that issue lands.
- `npm run build` needs `node_modules/tailwindcss/theme.css`, absent with the pinned Tailwind (#13).
- `ruff` (19) and `mypy` (9) are red on `main`; report deltas against those baselines, not zero.
