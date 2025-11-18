# Pulseboard

Real-time, pluggable data dashboard for developers and tinkerers.

Pulseboard is a web-first, real-time dashboard platform that lets users monitor arbitrary data feeds (system metrics, repo stats, financial prices, IoT sensors, etc.) via a modern browser UI. It is designed to run both locally (offline-first, via `localhost`) and as a deployed web application.

## Features

- **Real-time streaming** via WebSockets
- **Pluggable feed system** - easily add new data sources
- **Multiple panel types** - time-series charts, stat tiles, bar charts
- **Modern tech stack** - FastAPI, Vue 3, TypeScript, ECharts, TailwindCSS
- **Three built-in feeds**:
  - System Metrics (CPU, RAM, disk usage via psutil)
  - HTTP JSON (poll any JSON API)
  - Crypto Prices (real-time cryptocurrency prices via CoinGecko)

## Tech Stack

### Backend
- Python 3.11+
- FastAPI (REST API + WebSockets)
- SQLModel (ORM with Pydantic)
- SQLite (database)
- psutil (system metrics)
- httpx (HTTP client)

### Frontend
- Vue 3 + Vite
- TypeScript
- Pinia (state management)
- TailwindCSS (styling)
- Apache ECharts (charts)

## Quick Start

### Prerequisites

- Python 3.11 or higher
- Node.js 18+ (for frontend, coming soon)

### Backend Setup

1. **Clone the repository**

```bash
git clone <repository-url>
cd Pulseboard
```

2. **Use the development startup script**

```bash
./scripts/dev_start.sh
```

This script will:
- Create a virtual environment
- Install all dependencies
- Start the backend server on `http://localhost:8000`

3. **Seed demo data** (optional, in a new terminal)

```bash
# Activate virtual environment
source venv/bin/activate

# Run seed script
python scripts/seed_demo_data.py
```

This creates:
- A demo dashboard with system metrics and crypto prices
- System metrics feed (CPU, RAM, disk)
- Bitcoin and Ethereum price feeds
- 6 panels showing live data

4. **Access the API**

- API docs: `http://localhost:8000/docs`
- Health check: `http://localhost:8000/health`
- Interactive API documentation: `http://localhost:8000/redoc`

### Manual Backend Setup

If you prefer manual setup:

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r backend/requirements.txt

# Run the server
cd backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup

1. **Use the development startup script**

```bash
./scripts/dev_start_frontend.sh
```

This script will:
- Install dependencies if needed
- Start the frontend development server on `http://localhost:5173`

2. **Access the application**

Open your browser and navigate to `http://localhost:5173`

The frontend will automatically proxy API requests to the backend.

### Manual Frontend Setup

If you prefer manual setup:

```bash
# Navigate to frontend directory
cd frontend/pulseboard-web

# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

## Architecture

### Data Flow

1. **Feed Manager** loads enabled feed definitions from database
2. **Feeds** run as background asyncio tasks, fetching data periodically
3. **DataHub** receives feed events and maintains latest values + history
4. **WebSocket connections** subscribe to dashboards
5. **DataHub** broadcasts feed updates to relevant dashboard connections
6. **Frontend** receives updates via WebSocket and updates charts in real-time

### Key Components

#### Backend

- **`app/core/`** - Configuration and logging
- **`app/db/`** - Database engine and session management
- **`app/models/`** - SQLModel definitions for Dashboard, Feed, Panel
- **`app/feeds/`** - Feed implementations and registry
  - `base.py` - Abstract BaseFeed class
  - `system_metrics.py` - System metrics via psutil
  - `http_json.py` - Generic HTTP JSON polling
  - `crypto_price.py` - Cryptocurrency prices
  - `manager.py` - Feed lifecycle management
- **`app/hub/`** - DataHub for event management and broadcasting
- **`app/api/routes/`** - REST API endpoints
- **`app/ws/`** - WebSocket router and connection manager
- **`app/main.py`** - FastAPI application and lifespan management

#### Frontend

- **`src/types/`** - TypeScript interfaces matching backend models
- **`src/api/`** - API client for backend communication
- **`src/stores/`** - Pinia stores for state management
  - `dashboards.ts` - Dashboard CRUD operations
  - `liveData.ts` - Feed event storage and history
  - `ui.ts` - UI state (WebSocket status, dark mode)
- **`src/composables/`** - Reusable composition functions
  - `useDashboardWebSocket.ts` - WebSocket management with auto-reconnect
- **`src/components/panels/`** - Panel components
  - `PanelStat.vue` - Single value with trend
  - `PanelTimeseries.vue` - Line chart with ECharts
  - `PanelBar.vue` - Bar chart with ECharts
- **`src/views/`** - Page components
  - `DashboardListView.vue` - Dashboard grid and creation
  - `DashboardLiveView.vue` - Live dashboard with panels
- **`src/router/`** - Vue Router configuration

## API Endpoints

### Dashboards

- `GET /api/dashboards` - List all dashboards
- `POST /api/dashboards` - Create dashboard
- `GET /api/dashboards/{id}` - Get dashboard with panels
- `PATCH /api/dashboards/{id}` - Update dashboard
- `DELETE /api/dashboards/{id}` - Delete dashboard
- `GET /api/dashboards/{id}/feed-ids` - Get feed IDs used by dashboard

### Feeds

- `GET /api/feeds` - List all feed definitions
- `POST /api/feeds` - Create feed definition
- `GET /api/feeds/{id}` - Get feed definition
- `PATCH /api/feeds/{id}` - Update feed definition
- `DELETE /api/feeds/{id}` - Delete feed definition

### Panels

- `POST /api/dashboards/{dashboard_id}/panels` - Create panel
- `PATCH /api/dashboards/{dashboard_id}/panels/{panel_id}` - Update panel
- `DELETE /api/dashboards/{dashboard_id}/panels/{panel_id}` - Delete panel
- `GET /api/panels/{id}` - Get panel by ID

### WebSocket

- `WS /ws/dashboards/{dashboard_id}` - Real-time dashboard updates

## Feed Types

### System Metrics

Monitors system CPU, RAM, and optionally disk/network.

**Config:**
```json
{
  "interval_sec": 5,
  "include_disk": true,
  "include_network": false
}
```

**Output:**
```json
{
  "cpu_percent": 45.2,
  "memory_percent": 68.1,
  "memory_used_gb": 10.9,
  "memory_total_gb": 16.0,
  "disk_percent": 72.3,
  "disk_used_gb": 361.5,
  "disk_total_gb": 500.0
}
```

### HTTP JSON

Polls any JSON HTTP endpoint.

**Config:**
```json
{
  "url": "https://api.example.com/data",
  "interval_sec": 60,
  "method": "GET",
  "headers": {},
  "path": "data.metrics"
}
```

### Crypto Price

Fetches cryptocurrency prices from CoinGecko.

**Config:**
```json
{
  "coin_id": "bitcoin",
  "vs_currency": "usd",
  "interval_sec": 30,
  "include_market_data": true
}
```

**Output:**
```json
{
  "coin_id": "bitcoin",
  "vs_currency": "usd",
  "price": 69420.50,
  "market_cap": 1360000000000,
  "24h_volume": 28500000000,
  "24h_change": 2.45
}
```

## Development

### Running Tests

```bash
# Activate virtual environment
source venv/bin/activate

# Run tests with coverage
cd backend
pytest

# Run specific test file
pytest tests/unit/test_feeds.py

# Run with verbose output
pytest -v
```

### Code Quality

```bash
# Format code with black
black backend/app backend/tests

# Lint with ruff
ruff check backend/app

# Type checking with mypy
mypy backend/app
```

## Project Structure

```
pulseboard/
├── README.md
├── pyproject.toml
├── .env.example
├── backend/
│   ├── app/
│   │   ├── core/         # Config and logging
│   │   ├── db/           # Database setup
│   │   ├── models/       # SQLModel definitions
│   │   ├── feeds/        # Feed implementations
│   │   ├── hub/          # DataHub and events
│   │   ├── api/          # REST API routes
│   │   ├── ws/           # WebSocket router
│   │   └── main.py       # FastAPI app
│   ├── tests/
│   │   ├── unit/         # Unit tests
│   │   └── integration/  # Integration tests
│   └── requirements.txt
├── frontend/             # Vue 3 app (coming soon)
└── scripts/
    ├── seed_demo_data.py
    └── dev_start.sh
```

## Roadmap

- [x] Backend core (FastAPI, SQLModel, database)
- [x] Feed system (BaseFeed, SystemMetrics, HTTP JSON, Crypto)
- [x] DataHub for event management
- [x] REST API endpoints
- [x] WebSocket streaming
- [x] Seed demo data
- [x] Vue 3 frontend with TypeScript
- [x] Dashboard and panel components
- [x] ECharts integration
- [x] Real-time WebSocket updates
- [x] Dark mode UI with TailwindCSS
- [ ] Panel editing and dashboard layout customization
- [ ] PWA support
- [ ] Additional feed types (Git metrics, Taskdeck)
- [ ] Desktop wrapper (Electron/Tauri)
- [ ] User authentication and multi-tenancy

## License

MIT

## Contributing

Contributions welcome! This is primarily a personal project, but pull requests are encouraged.

For questions or issues, please open a GitHub issue.
