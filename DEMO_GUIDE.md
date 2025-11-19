# Pulseboard Demo Guide

## Current Status

✅ **Backend Server:** Running on http://localhost:8000
✅ **Frontend Server:** Running on http://localhost:5173
✅ **Database:** Seeded with demo data
✅ **Feeds Running:** 3 feeds (System Metrics, Bitcoin Price, Ethereum Price)

## Quick Demo

### 1. Access the Application

Open your browser and navigate to: **http://localhost:5173**

### 2. View the Dashboard

You'll see the dashboard list page. Click on:
- **"System & Crypto Monitor"** dashboard

This dashboard includes 6 panels:
- **CPU Usage** (timeseries chart)
- **RAM Usage** (timeseries chart)
- **Disk Usage** (timeseries chart)
- **Bitcoin Price** (stat panel)
- **Ethereum Price** (stat panel)
- **System Overview** (bar chart)

### 3. Watch Real-Time Updates

- **System metrics** update every 2 seconds
- **Crypto prices** update every 30 seconds (may show errors due to API rate limits)
- Charts animate smoothly as new data arrives via WebSocket

### 4. API Documentation

Backend API docs available at: **http://localhost:8000/docs**

## Key Features to Demonstrate

### Real-Time Streaming
- Open browser dev tools → Network tab → WS filter
- See WebSocket connection to `/ws/dashboards/{id}`
- Watch `feed_update` messages flowing in real-time

### Pluggable Feed System
- 3 feed types implemented:
  - **System Metrics:** Uses psutil to monitor CPU, RAM, disk
  - **HTTP JSON:** Generic JSON API polling
  - **Crypto Price:** CoinGecko API integration

### Modern Tech Stack
- **Backend:** FastAPI + SQLModel + WebSockets
- **Frontend:** Vue 3 + TypeScript + Pinia + ECharts + TailwindCSS
- **Real-time:** WebSocket with automatic reconnection

## API Endpoints to Test

```bash
# Health check
curl http://localhost:8000/health

# List dashboards
curl http://localhost:8000/api/dashboards

# Get dashboard with panels
curl http://localhost:8000/api/dashboards/dfce4f15-4a22-4a6d-bf0e-ffb199862a81

# List feeds
curl http://localhost:8000/api/feeds
```

## Architecture Highlights

### Data Flow
1. **Feeds** run as background asyncio tasks
2. **DataHub** maintains latest values + 10min history window
3. **WebSocket** broadcasts updates to connected dashboards
4. **Frontend** stores last 100 events per feed
5. **Panel components** reactively render from Pinia stores

### Key Components

**Backend:**
- `app/feeds/manager.py` - Lifecycle management
- `app/hub/hub.py` - Event broadcasting
- `app/ws/router.py` - WebSocket connections
- `app/feeds/base.py` - Feed abstraction

**Frontend:**
- `src/stores/liveData.ts` - Feed event storage
- `src/composables/useDashboardWebSocket.ts` - WebSocket with auto-reconnect
- `src/components/panels/` - Panel types (Stat, Timeseries, Bar)

## New Features in Phase 4

### ✅ Feed Management UI
- **Feeds page** at `/feeds` with full CRUD interface
- **Test feeds** with live results dialog showing success/error and data
- Create, edit, delete feeds directly from the browser
- Visual status indicators for enabled/disabled feeds

### ✅ Panel Drag and Drop
- **Drag panels** to reposition them on the dashboard
- Grid-snapping with 12-column layout
- Visual drag handle at top center (blue gradient)
- Real-time preview during drag

### ✅ Panel Resize
- **Resize panels** from the bottom-right corner
- Grid-snapping with dimension constraints
- Visual resize handle (purple gradient)
- Prevents invalid panel sizes

### ✅ PWA Support
- **Install as desktop/mobile app**
- Service worker for offline caching
- Installable from browser (look for install button in address bar)
- App icons and manifest configured

### ✅ Frontend Testing
- **56 tests passing** (API client, stores, utilities)
- Comprehensive test coverage for core functionality
- Vitest with happy-dom environment

## Known Issues (Demo Limitations)

1. **Crypto API Rate Limits:** CoinGecko free tier has strict rate limits. You may see 429 errors in logs. This is normal and demonstrates error handling. System metrics will work fine.

2. **Panel Add/Delete UI:** No UI for adding new panels to dashboard or deleting panels from dashboard view yet. Use API directly for these operations.

## Stop the Demo

```bash
# In terminals where servers are running, press Ctrl+C
# Or kill the background processes
```

## Next Development Steps

According to STATUS.md, the application is now production-ready for internal use. Future enhancements include:
1. Panel add/delete UI from dashboard view
2. Component tests for Vue components
3. E2E tests with Playwright
4. Additional feed types (RepoScope, Taskdeck)
5. Desktop wrapper (Electron/Tauri)
6. Authentication for public deployment

## Dashboard ID for Reference

**System & Crypto Monitor:** `dfce4f15-4a22-4a6d-bf0e-ffb199862a81`

Direct link: http://localhost:5173/dashboards/dfce4f15-4a22-4a6d-bf0e-ffb199862a81
