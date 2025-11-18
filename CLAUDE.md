# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pulseboard is a real-time data dashboard platform built with FastAPI (backend) and Vue 3 (frontend). It streams data from pluggable feeds (system metrics, HTTP JSON, crypto prices) via WebSockets to a browser UI with live-updating charts.

## Development Commands

### Backend

```bash
# Start development server (recommended - auto-setup)
./scripts/dev_start.sh

# Manual setup
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r backend/requirements.txt
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Seed demo data (creates dashboard with system metrics and crypto feeds)
source venv/bin/activate
python scripts/seed_demo_data.py

# Testing
cd backend
pytest                           # Run all tests
pytest tests/unit/test_feeds.py  # Run specific test file
pytest -v                        # Verbose output
pytest --cov                     # With coverage

# Code quality
black backend/app backend/tests  # Format code
ruff check backend/app           # Lint
mypy backend/app                 # Type checking
```

### Frontend

```bash
# Start development server (recommended - auto-setup)
./scripts/dev_start_frontend.sh

# Manual setup
cd frontend/pulseboard-web
npm install
npm run dev         # Development server on http://localhost:5173
npm run build       # Production build
npm run preview     # Preview production build

# Testing (infrastructure exists but tests not yet written)
npm run test        # Run tests
npm run test:ui     # Test UI
```

## Core Architecture

### Data Flow (Backend → Frontend)

1. **FeedManager** (backend/app/feeds/manager.py) loads enabled `FeedDefinition`s from DB on startup
2. **Feeds** (backend/app/feeds/*.py) run as background asyncio tasks, calling `fetch_data()` at configured intervals
3. **DataHub** (backend/app/hub/hub.py) receives feed events via `publish_feed_event()`, stores latest + 10min history window
4. **WebSocket connections** (backend/app/ws/router.py) established per dashboard at `/ws/dashboards/{id}`
5. **DataHub** broadcasts feed updates only to dashboards using those feeds
6. **Frontend composable** (src/composables/useDashboardWebSocket.ts) manages WS connection with exponential backoff reconnection
7. **liveDataStore** (src/stores/liveData.ts) receives events and maintains latest + last 100 events per feed
8. **Panel components** (src/components/panels/*.vue) reactively render charts from store data

### Key Backend Components

**Lifecycle (app/main.py:34-71):**
- `lifespan()` context manager handles startup/shutdown
- On startup: creates DB tables → initializes DataHub → loads/starts feeds via FeedManager
- On shutdown: stops all feeds cleanly

**Feed System:**
- `BaseFeed` (app/feeds/base.py): Abstract class with `fetch_data()` method and `run()` loop
- Feed implementations: `SystemMetricsFeed`, `HttpJsonFeed`, `CryptoPriceFeed`
- Registry pattern: `get_feed_class(type)` in `app/feeds/__init__.py` maps feed types to classes
- `FeedManager.start_feed()`: parses `config_json` from DB, instantiates feed class, starts asyncio task

**DataHub (app/hub/hub.py):**
- Maintains `latest: Dict[UUID, FeedEvent]` and `history: Dict[UUID, Deque[FeedEvent]]`
- `dashboard_feeds: Dict[UUID, Set[UUID]]` tracks which feeds each dashboard uses
- On event: updates latest, appends to history, trims old events, broadcasts to relevant dashboards
- On WS connection: sends initial state (latest events for dashboard's feeds)

**WebSocket (app/ws/router.py):**
- Endpoint: `/ws/dashboards/{dashboard_id}`
- On connect: queries DB for dashboard's panels → extracts feed IDs → registers with DataHub
- DataHub sends initial state, then real-time updates
- Ping/pong keepalive handled by frontend

### Key Frontend Components

**State Management (Pinia):**
- `dashboardsStore` (src/stores/dashboards.ts): Dashboard CRUD operations
- `liveDataStore` (src/stores/liveData.ts): Feed event storage (latest + history)
- `uiStore` (src/stores/ui.ts): WS status, dark mode, error messages

**WebSocket Composable (src/composables/useDashboardWebSocket.ts):**
- Auto-reconnect with exponential backoff (max 5 attempts)
- 30-second ping interval to keep connection alive
- Parses `FeedEventMessage` and calls `liveDataStore.applyFeedUpdate()`
- Cleans up on component unmount

**Panel Types:**
- `PanelStat.vue`: Single value with trend indicator
- `PanelTimeseries.vue`: Line chart using ECharts
- `PanelBar.vue`: Bar chart using ECharts
- All panels use `panel.config.feed_key` to extract value from `payload`

### Database Models (SQLModel)

**Dashboard** (app/models/dashboard.py):
- Fields: `id`, `name`, `description`, `created_at`, `updated_at`
- Relationship: `panels` (one-to-many)

**FeedDefinition** (app/models/feed.py):
- Fields: `id`, `name`, `type`, `config_json`, `enabled`, `created_at`, `updated_at`
- `config_json` contains feed-specific settings (e.g., `interval_sec`, `coin_id`, `url`)

**Panel** (app/models/panel.py):
- Fields: `id`, `dashboard_id`, `title`, `type`, `config_json`, `position`, `created_at`, `updated_at`
- `config_json` contains `feed_id` and `feed_key` (JSONPath to extract value from payload)

## Creating a New Feed Type

1. **Create feed class** in `backend/app/feeds/your_feed.py`:
   ```python
   from app.feeds.base import BaseFeed

   class YourFeed(BaseFeed):
       async def fetch_data(self) -> Dict[str, Any]:
           # Fetch data from source
           return {"key": "value"}
   ```

2. **Register feed** in `backend/app/feeds/__init__.py`:
   ```python
   from .your_feed import YourFeed

   _FEED_REGISTRY = {
       "your_feed": YourFeed,
       # ...
   }
   ```

3. **Add feed via API**:
   ```bash
   curl -X POST http://localhost:8000/api/feeds \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Your Feed",
       "type": "your_feed",
       "config_json": "{\"interval_sec\": 30}",
       "enabled": true
     }'
   ```

4. **Restart backend** to load new feed (or call `FeedManager.restart_feed()`)

## Testing Strategy

**Backend (85% coverage):**
- Unit tests: `tests/unit/test_config.py`, `test_models.py`, `test_feeds.py`, `test_hub.py`
- Integration tests: `tests/integration/test_api.py` (REST endpoints), `test_websocket.py` (WS)
- Uses in-memory SQLite for test isolation
- Async tests via `pytest-asyncio`

**Frontend (tests planned but not written):**
- Infrastructure: Vitest configured in `vite.config.ts`
- Test stores, composables, and components
- Target: 70%+ coverage before production deployment

## Configuration

**Backend (.env):**
- `DATABASE_URL`: SQLite path (default: `sqlite:///./pulseboard.db`)
- `CORS_ORIGINS`: Comma-separated allowed origins (default: `http://localhost:5173`)
- `HISTORY_WINDOW_MINUTES`: DataHub history window (default: `10`)
- `LOG_LEVEL`: Logging level (default: `INFO`)

**Frontend (frontend/pulseboard-web/.env):**
- `VITE_API_BASE_URL`: Backend API URL (default: proxied via Vite in dev)

## Common Pitfalls

**Feed cancellation:** Feeds check `self._running` and `self._stop_requested` at multiple points in `run()` loop to ensure clean shutdown. Always check these flags after `await` calls.

**WebSocket reconnection:** Frontend has max 5 reconnect attempts with exponential backoff. If connection fails permanently, user must refresh page.

**Feed config JSON:** Must be valid JSON string stored in DB. Parse with `json.loads()` in `FeedManager.start_feed()`.

**Panel feed_key:** Uses dot notation (e.g., `"cpu_percent"` or `"data.metrics.value"`) to extract values from feed payload. ECharts panels expect numeric values.

**History window:** DataHub stores 10 minutes of history (configurable). Frontend stores last 100 events per feed. These are independent limits.

## API Endpoints

**Dashboards:** `GET|POST /api/dashboards`, `GET|PATCH|DELETE /api/dashboards/{id}`, `GET /api/dashboards/{id}/feed-ids`

**Feeds:** `GET|POST /api/feeds`, `GET|PATCH|DELETE /api/feeds/{id}`

**Panels:** `POST /api/dashboards/{dashboard_id}/panels`, `PATCH|DELETE /api/dashboards/{dashboard_id}/panels/{panel_id}`, `GET /api/panels/{id}`

**WebSocket:** `WS /ws/dashboards/{dashboard_id}`

**Health:** `GET /health`, `GET /`

## Current Status (Phase 4 - UX Features)

**Complete:** Core functionality, 3 feed types, 3 panel types, backend tests, real-time streaming

**In Progress:** Feed management UI, panel creation/editing UI, frontend tests

**Planned:** PWA support, additional feeds (RepoScope, Taskdeck), desktop wrapper, alerting

See STATUS.md for detailed implementation status.
