# Pulseboard – Real-Time Pluggable Data Dashboard

## 0. Overview

**Name:** Pulseboard  
**Tagline:** Real-time, pluggable data dashboard for developers and tinkerers.

Pulseboard is a web-first, real-time dashboard platform that lets users monitor arbitrary data feeds (system metrics, repo stats, financial prices, IoT sensors, etc.) via a modern browser UI. It is designed to run both locally (offline-first, via `localhost`) and as a deployed web application.

This document specifies the **vision**, **feature set**, **architecture**, **data model**, **backend**, **frontend**, **WebSocket layer**, **plugin model**, **deployment**, and **roadmap**.

---

## 1. Vision & Goals

### 1.1 Problem

Developers, ops people, and hobbyists often want a “mission control” view of:

- System health (CPU, RAM, disk, network).
- Repository activity (commits per day, build status).
- Financial or crypto prices.
- IoT / home automation metrics.

Existing solutions are often:

- Tied to specific SaaS products.
- Overly complex (full observability stacks) for small setups.
- Hard to customize or extend with your own data sources.

### 1.2 High-Level Goals

1. **Web-first real-time dashboard**  
   - Accessible from any browser.
   - Works locally and in deployed environments.

2. **Pluggable data feeds**  
   - Each feed knows how to fetch or receive data from some source.
   - Easy to add new feeds in Python.

3. **Modular panels & layouts**  
   - Multiple panel types: time-series charts, stat tiles, bar charts, tables.
   - Dashboards composed of panels in a configurable grid layout.

4. **Developer-friendly stack**  
   - Backend: FastAPI (Python), WebSockets, async feeds.
   - Frontend: Vue 3, Vite, TypeScript, ECharts, Tailwind.

5. **Future integrations with other projects**  
   - Taskdeck (task counts per board/column).
   - RepoScope (Git repository metrics).
   - DevFoundry (tool-based feeds).

### 1.3 Non-Goals (MVP)

- Full-fledged alerting system (email/SMS notifications, escalations).
- Multi-tenant SaaS with complex user management.
- Massive long-term storage and analytics (can be added later).

---

## 2. Feature Overview

### 2.1 MVP Feature Set

**Feeds**

- System metrics feed (CPU, RAM usage) using psutil.
- HTTP JSON polling feed for generic APIs.
- Simple demo feed (random data) for testing.

**Dashboards & Panels**

- Create multiple dashboards.
- Add panels to dashboards.
- Panel types:
  - Time-series line chart (e.g., CPU over time).
  - Stat panel (single numeric value with trend arrow).
  - Bar chart (e.g., commits per author).

**Real-time streaming**

- WebSocket connection per dashboard.
- Feeds push updates into a central hub; hub broadcasts relevant updates to connected clients.

**Configuration**

- Persist dashboards, panels, and feed definitions in a SQLite database.
- Update feed configs (interval, API endpoint, etc.).

**Web UI**

- Dark-theme dashboard with modern look and feel.
- Responsive layout using CSS grid.
- Live-updating charts with smooth animations.

### 2.2 Near-Term Features

- Additional feed types:
  - Crypto price feed.
  - RepoScope feed (Git metrics).
  - Taskdeck feed (tasks counts per column).
- Historical data storage for specific window (e.g., last 24 hours).
- Editing dashboards (drag-and-drop panel layout, rename, delete).
- PWA support for offline-capable app shell.

### 2.3 Long-Term Ideas

- Alerting (threshold-based highlighting, notifications).
- Recording & playback of past periods.
- Role-based access and user accounts.
- Plugin system for external feed packages.
- Desktop wrapper via Electron or Tauri.

---

## 3. System Architecture

### 3.1 High-Level Components

1. **Pulseboard Backend (FastAPI)**
   - REST API for dashboards, panels, and feeds.
   - WebSocket endpoints for real-time updates.
   - Feed scheduler and manager.
   - Data hub for broadcasting updates.
   - SQLite-based persistence (SQLAlchemy/SQLModel).

2. **Pulseboard Frontend (Vue 3)**
   - Single Page Application (SPA).
   - Dashboard list and dashboard view.
   - ECharts-based panel components.
   - WebSocket client for live data.

3. **Feeds**
   - Modules/classes implementing specific data sources.
   - Configurable and extensible.

4. **Data Hub**
   - In-memory structure holding latest data & recent history.
   - Routes feed events to WebSocket clients.

### 3.2 Data Flow

1. Backend starts, initializes DB, DataHub, and feed manager.
2. Feed manager looks up enabled feed definitions in DB, instantiates corresponding feed classes, and starts them as background tasks.
3. Each feed periodically fetches data and publishes `FeedEvent` objects into the DataHub.
4. DataHub updates latest values, optionally appends to history, and broadcasts events to WebSocket subscribers (dashboard clients).
5. Frontend connects to `/ws/dashboards/{dashboard_id}`, receives `feed_update` messages, and updates charts and stat panels.

---

## 4. Tech Stack

### 4.1 Backend

- Language: Python 3.11+
- Framework: FastAPI (ASGI)
- Server: Uvicorn (development and simple deployment)
- Persistence: SQLite + SQLAlchemy/SQLModel
- Real-time: WebSockets (FastAPI integration)
- Background tasks: asyncio tasks, possibly APScheduler later
- Dependencies (examples):
  - `fastapi`
  - `uvicorn`
  - `sqlalchemy` or `sqlmodel`
  - `psutil` (for system metrics)
  - `pydantic` (data models)

### 4.2 Frontend

- Framework: Vue 3
- Tooling: Vite
- Language: TypeScript
- State: Pinia
- Router: Vue Router
- Charts: Apache ECharts (via a Vue wrapper or direct integration)
- Styling: TailwindCSS

### 4.3 Optional Components

- PWA support: service worker + manifest.
- Desktop: Electron or Tauri wrapper that points to local backend.

---

## 5. Repository & Folder Structure

```text
pulseboard/
  README.md
  pyproject.toml
  .gitignore
  .env.example

  backend/
    app/
      core/
        config.py
        logging.py
      db/
        base.py
        session.py
        migrations/
      models/
        dashboard.py
        feed.py
        panel.py
      feeds/
        base.py
        system_metrics.py
        http_json.py
        crypto_price.py
      hub/
        hub.py
        events.py
      api/
        deps.py
        routes/
          dashboards.py
          panels.py
          feeds.py
      ws/
        router.py
        manager.py
      main.py

  frontend/
    pulseboard-web/
      (Vite + Vue 3 + TS project)

  scripts/
    dev_start.sh
    seed_demo_data.py
```

---

## 6. Data Model

### 6.1 Database Entities

**Dashboard**

- `id: UUID` (primary key)
- `name: str`
- `description: str | None`
- `layout_json: str` (JSON for panel positions and sizes)
- `created_at: datetime`
- `updated_at: datetime`

**FeedDefinition**

- `id: UUID`
- `type: str` (e.g., "system_metrics", "http_json", "crypto_price")
- `name: str`
- `config_json: str` (feed-specific configuration)
- `enabled: bool`
- `created_at: datetime`
- `updated_at: datetime`

**PanelDefinition**

- `id: UUID`
- `dashboard_id: UUID` (FK to Dashboard)
- `type: str` (e.g., "timeseries", "stat", "bar", "table")
- `title: str`
- `feed_ids_json: str` (JSON array of feed IDs)
- `options_json: str` (JSON object with chart options / thresholds)
- `position_x: int`
- `position_y: int`
- `width: int`
- `height: int`

**MetricPoint** (optional for history)

- `id: UUID`
- `feed_id: UUID`
- `timestamp: datetime`
- `payload_json: str`

### 6.2 Pydantic Models

Mirror the DB entities with Pydantic models for request/response payloads:

- `DashboardCreate`, `DashboardUpdate`, `DashboardRead`
- `FeedCreate`, `FeedUpdate`, `FeedRead`
- `PanelCreate`, `PanelUpdate`, `PanelRead`

---

## 7. Feeds & Hub Design

### 7.1 Feed Abstractions

`backend/app/feeds/base.py`:

```python
from abc import ABC, abstractmethod
from datetime import datetime
from pydantic import BaseModel
from typing import Dict, Any

class FeedEvent(BaseModel):
    feed_id: str
    ts: datetime
    payload: Dict[str, Any]

class BaseFeed(ABC):
    def __init__(self, feed_id: str, config: Dict[str, Any], hub: "DataHub"):
        self.feed_id = feed_id
        self.config = config
        self.hub = hub

    @abstractmethod
    async def run(self) -> None:
        """Run loop that produces events and publishes to the hub."""
        ...
```

### 7.2 Example Feeds

**SystemMetricsFeed**

- Uses `psutil` to read CPU and RAM usage.
- Config keys: `interval_sec`.
- Emits payload:

```json
{
  "cpu": 42.3,
  "ram": 68.1
}
```

**HttpJsonFeed**

- Generic HTTP GET to a JSON endpoint.
- Config keys: `url`, `interval_sec`, `path` (optional JSONPath-like path into response).
- Emits the extracted JSON as payload.

**CryptoPriceFeed**

- Calls a crypto price API for a symbol.
- Config keys: `symbol`, `interval_sec`, `api_url`.
- Emits:

```json
{
  "symbol": "BTCUSDT",
  "price": 69000.12
}
```

### 7.3 Feed Registry & Manager

`FEED_TYPES` mapping in `feeds/__init__.py`:

```python
from .system_metrics import SystemMetricsFeed
from .http_json import HttpJsonFeed
from .crypto_price import CryptoPriceFeed

FEED_TYPES = {
    "system_metrics": SystemMetricsFeed,
    "http_json": HttpJsonFeed,
    "crypto_price": CryptoPriceFeed,
}
```

A `FeedManager` component:

- Loads enabled `FeedDefinition` records.
- Instantiates feed objects with config and DataHub.
- Starts each `feed.run()` in an asyncio Task.
- Provides methods to start/stop/reload feeds when config changes.

### 7.4 Data Hub

`backend/app/hub/hub.py`:

```python
from collections import defaultdict, deque
from typing import Dict, Deque, List
from datetime import datetime, timedelta
from .events import FeedEvent

class DataHub:
    def __init__(self, history_window: timedelta = timedelta(minutes=10)):
        self.latest: Dict[str, FeedEvent] = {}
        self.history: Dict[str, Deque[FeedEvent]] = defaultdict(deque)
        self.history_window = history_window
        self.connections: Dict[str, List["WebSocketConnection"]] = defaultdict(list)

    async def publish(self, event: FeedEvent) -> None:
        self.latest[event.feed_id] = event
        dq = self.history[event.feed_id]
        dq.append(event)

        cutoff = datetime.utcnow() - self.history_window
        while dq and dq[0].ts < cutoff:
            dq.popleft()

        await self.broadcast(event)

    async def broadcast(self, event: FeedEvent) -> None:
        # For each dashboard subscribed to this feed, send event via WS
        # Logic will depend on dashboard-panel-feed mapping.
        ...
```

`connections` holds WebSocket connections grouped by dashboard ID.

---

## 8. Backend API & WebSocket Layer

### 8.1 REST API Design

Base path: `/api`.

**Dashboards**

- `GET /api/dashboards`  
  List dashboards.

- `POST /api/dashboards`  
  Create new dashboard.

- `GET /api/dashboards/{dashboard_id}`  
  Return a dashboard with its panels and associated feeds.

- `PUT /api/dashboards/{dashboard_id}`  
  Update dashboard metadata and layout.

- `DELETE /api/dashboards/{dashboard_id}`  
  Delete dashboard and its panels.

**Panels**

- `POST /api/dashboards/{dashboard_id}/panels`  
  Create a new panel on a dashboard.

- `PATCH /api/panels/{panel_id}`  
  Update panel title, type, feed IDs, options, or position.

- `DELETE /api/panels/{panel_id}`  
  Remove a panel.

**Feeds**

- `GET /api/feeds`  
  List all feed definitions.

- `POST /api/feeds`  
  Create a new feed definition.

- `PATCH /api/feeds/{feed_id}`  
  Update feed configuration and enabled flag.

- `DELETE /api/feeds/{feed_id}`  
  Remove feed definition.

- `POST /api/feeds/{feed_id}/test`  
  Run the feed once and return a sample event (without registering it in the hub).

**History** (optional in MVP)

- `GET /api/feeds/{feed_id}/history?since=&until=`  
  Return historical FeedEvents for chart initialization.

### 8.2 WebSocket Endpoint

**Route**: `/ws/dashboards/{dashboard_id}`

Protocol:

- Client opens a WebSocket connection.
- Server authenticates (if auth is implemented later); in MVP, allow all connections.
- Server registers client in `DataHub.connections[dashboard_id]`.
- Initial handshake: server may send current snapshot for relevant feeds.
- On new `FeedEvent`, DataHub identifies dashboards whose panels reference `feed_id` and pushes messages:

```json
{
  "type": "feed_update",
  "feed_id": "<uuid>",
  "ts": "2025-11-18T13:37:00Z",
  "payload": { "cpu": 52.3, "ram": 71.8 }
}
```

Client responsibilities:

- Maintain WS connection.
- Handle reconnection if closed.
- Update charts and panels when messages arrive.

### 8.3 WebSocket Manager

A `ConnectionManager` in `ws/manager.py`:

- `connect(dashboard_id, websocket)`
- `disconnect(dashboard_id, websocket)`
- `send_personal_message(dashboard_id, message, websocket)`
- `broadcast_to_dashboard(dashboard_id, message)`

DataHub’s `broadcast` method delegates to `ConnectionManager` with mapping from feed_id → dashboards.

---

## 9. Frontend Application Design

### 9.1 Routes & Screens

- `/`  
  Redirect to `/dashboards`.

- `/dashboards` (DashboardsListView)
  - Display list of dashboards with name, description.
  - “Create Dashboard” button.

- `/dashboards/:id` (DashboardLiveView)
  - Render dashboard with panels.
  - Establish WebSocket connection.

- `/dashboards/:id/edit` (DashboardEditView – later)
  - Edit panel layout and configuration.

### 9.2 State Management (Pinia)

**dashboardsStore**

- State:
  - `dashboards: DashboardSummary[]`
  - `currentDashboard: DashboardDetail | null`
- Actions:
  - `fetchDashboards()`
  - `fetchDashboardById(id)`
  - `createDashboard(payload)`
  - `updateDashboard(id, payload)`

**liveDataStore**

- State:
  - `latest: Record<feedId, FeedEvent>`
  - `history: Record<feedId, FeedEvent[]>` (limited window)
- Actions:
  - `applyFeedUpdate(event)`
  - `setHistory(feedId, events)`

**uiStore**

- State:
  - `wsStatus: 'connecting' | 'connected' | 'disconnected'`
  - `errorMessage: string | null`
- Actions:
  - `setWsStatus(status)`
  - `setError(message)`

### 9.3 Components

**AppShell.vue**

- Top bar with:
  - Logo and app name.
  - Current dashboard name.
  - WS status indicator.
  - Theme toggle.

- Sidebar with:
  - List of dashboards.
  - Create dashboard button.

**DashboardsListView.vue**

- List all dashboards.
- Simple card layout.

**DashboardLiveView.vue**

- Fetch dashboard definition.
- Connect to WebSocket `/ws/dashboards/:id`.
- Render a grid of `PanelWrapper`.

**PanelWrapper.vue**

- Layout container for a panel.
- Shows header (title, feed names) and body (panel content).

**PanelTimeseries.vue**

- Uses ECharts to render a line chart.
- Subscribes to one `feed_id` (or multiple) from `liveDataStore`.
- On new `FeedEvent`, appends data to chart series.

**PanelStat.vue**

- Shows latest value for a feed (e.g., CPU %).
- Shows small trend indicator (up/down vs previous value).

**PanelBar.vue**

- Bar chart panel for aggregated data (e.g., per-author metrics from a feed).

### 9.4 WebSocket Client

In `DashboardLiveView` (or a dedicated composable `useDashboardWs`):

- Create WebSocket with URL based on `dashboard_id`.
- On `open`, set `wsStatus = 'connected'`.
- On `message`, parse JSON and, if `type === 'feed_update'`, call `liveDataStore.applyFeedUpdate(event)`.
- On `close` or `error`, set `wsStatus = 'disconnected'` and try reconnect after a delay.

---

## 10. Offline & Desktop Story

### 10.1 Offline in Browser (PWA)

- Add `manifest.json` and service worker.
- Cache:
  - Main HTML, JS, CSS bundles.
  - Static assets (icons, fonts).
  - Optional demo `metrics.json` for offline demo.

Behavior:

- If offline and WS cannot connect, show an “Offline Demo” mode with simulated data or cached sample metrics.

### 10.2 Desktop Wrapper (Later)

- Use Electron or Tauri to create a desktop window.
- The wrapper launches the Python backend (or expects it to be running) and loads `http://localhost:8000`.
- Optionally bundle Python backend with the desktop app.

---

## 11. Testing Strategy

### 11.1 Backend

- Unit tests for:
  - Feed aggregation logic (DataHub history window).
  - Individual feed classes (e.g., SystemMetricsFeed mocked psutil).
- Integration tests:
  - API endpoints using FastAPI TestClient.
  - WebSocket connection tests (connect, receive events when publishing).

### 11.2 Frontend

- Unit tests (Vitest) for:
  - Stores (liveDataStore: applying events updates state correctly).
  - Components (PanelTimeseries renders with sample data).
- E2E tests (Playwright/Cypress) for:
  - Loading a dashboard and seeing live updates.
  - Handling WS reconnection.

---

## 12. Deployment & Environments

### 12.1 Local Development

Backend:

- `uvicorn app.main:app --reload --port 8000`

Frontend:

- `npm install`
- `npm run dev`

Configure CORS or serve frontend via backend in production.

### 12.2 Production Deployment

- Build frontend (`npm run build`) and serve static files from FastAPI using `StaticFiles` or a separate web server (Nginx).
- Run backend via Gunicorn + Uvicorn workers (or uvicorn behind a reverse proxy).
- Environment variables for DB URL, secret keys, etc.

### 12.3 Dockerization

- Dockerfile for backend.
- Dockerfile or multi-stage build for frontend.
- Docker Compose to run both + a reverse proxy.

---

## 13. Roadmap & Milestones

### Phase 1 – Minimal Live Dashboard

- Set up FastAPI skeleton and DataHub.
- Implement SystemMetricsFeed.
- Add WebSocket endpoint streaming system metrics.
- Scaffold Vue app with single `/` route.
- Show real-time CPU line chart.

### Phase 2 – Configurable Dashboards

- Add SQLite DB and models (Dashboard, PanelDefinition, FeedDefinition).
- Implement REST endpoints for dashboards, panels, and feeds.
- Implement dashboard view in frontend with multiple panels.
- Wire up WebSocket per dashboard, filtering events by subscribed feeds.

### Phase 3 – Additional Feeds & Panels

- Add CryptoPriceFeed and HttpJsonFeed.
- Add Stat and Bar panel types.
- Implement history window in DataHub and initial data load in frontend.

### Phase 4 – UX & Extensibility

- Add UI for creating/editing dashboards and panels.
- Add feed testing endpoint and UI.
- Add basic PWA configuration.
- Document how to write custom feeds.

### Phase 5 – Integrations & Desktop

- Integrate RepoScope and Taskdeck as feeds.
- Explore desktop wrapper.
- Add basic alerting features (color thresholds, badges).

---

## 14. Coding Guidelines

### 14.1 Backend (Python)

- Use type hints consistently.
- Keep FastAPI routes thin; delegate logic to services.
- Encapsulate feed logic in classes; avoid global state.
- Write small, testable functions for data transformation.

### 14.2 Frontend (Vue/TS)

- Use `<script setup lang="ts">` style.
- Keep panel components focused and reusable.
- Use stores for shared state; avoid prop drilling for live data.

### 14.3 Git Workflow

- Branch naming: `feature/<description>`, `fix/<description>`.
- Prefer small, focused pull requests.

---

## 15. Initial README Skeleton

```markdown
# Pulseboard

Pulseboard is a real-time, pluggable data dashboard for developers and tinkerers.

- Web-first, runs locally or deployed
- Real-time streaming via WebSockets
- Pluggable Python feeds (system metrics, HTTP JSON, crypto prices, etc.)
- Modern UI with Vue 3 + ECharts

## Tech Stack

**Backend**
- Python 3.11+
- FastAPI
- Uvicorn
- SQLite + SQLAlchemy/SQLModel
- WebSockets

**Frontend**
- Vue 3 + Vite
- TypeScript
- Pinia
- TailwindCSS
- Apache ECharts

## Getting Started (Development)

### Prerequisites

- Python 3.11+
- Node.js (LTS)

### Backend

```bash
cd backend
pip install -e .  # or pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend/pulseboard-web
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Roadmap

- [ ] System metrics live dashboard
- [ ] Configurable dashboards, panels, and feeds
- [ ] Additional feed types (crypto, HTTP JSON, Git metrics)
- [ ] PWA support
- [ ] Desktop wrapper

Pulseboard is primarily a personal and experimental project, but its architecture is designed for growth and integrations.
```

---

This document is a living design reference and should be updated as implementation evolves (new feeds, panel types, integrations, and deployment patterns).

