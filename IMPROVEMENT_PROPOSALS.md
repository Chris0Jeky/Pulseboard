# Pulseboard Improvement Proposals

## Overview

This document outlines potential improvements and enhancements for Pulseboard beyond the current Phase 4 completion. Each proposal is evaluated by impact and implementation effort.

**Current Status:** Phase 4 Complete - Production Ready for Internal Use

---

## High Priority (High Impact, Low-Medium Effort)

### 1. Panel Management UI

**Problem:** Users cannot add or delete panels from the dashboard view. Must use API directly.

**Proposed Solution:**
- Add "Add Panel" button on dashboard live view
- Panel creation dialog with:
  - Feed selector dropdown
  - Panel type selector (stat, timeseries, bar)
  - Feed key input with suggestions
  - Grid position and size inputs
- Delete button on each panel (trash icon, confirm dialog)
- Edit panel settings button (pencil icon)

**Benefits:**
- Complete CRUD experience without API knowledge
- Faster dashboard customization
- Better user experience for non-technical users

**Implementation Estimate:** 4-6 hours
- Backend: No changes needed (endpoints exist)
- Frontend: Panel creation dialog component, delete confirmation, UI integration

**Priority:** ⭐⭐⭐⭐⭐ (Critical UX gap)

---

### 2. WebSocket Connection Status Indicator

**Problem:** Users don't know if live data connection is active or reconnecting.

**Proposed Solution:**
- Visual indicator in top-right corner of dashboard view
- States:
  - 🟢 Connected (green dot)
  - 🟡 Reconnecting (yellow dot, pulsing)
  - 🔴 Disconnected (red dot)
  - ⚠️ Error with message
- Click to show connection details and manual reconnect button
- Connection status in dashboard list view

**Benefits:**
- Clear visibility into real-time data status
- Better debugging experience
- User confidence that data is live
- Manual retry option

**Implementation Estimate:** 2-3 hours
- Frontend: Status component, integrate with useDashboardWebSocket composable
- Use existing uiStore.wsStatus

**Priority:** ⭐⭐⭐⭐⭐ (Essential for production use)

---

### 3. Toast Notifications System

**Problem:** User feedback for operations (create, update, delete, errors) is limited.

**Proposed Solution:**
- Toast notification library (or custom component)
- Notifications for:
  - Dashboard created/updated/deleted
  - Feed created/updated/deleted/tested
  - Panel added/updated/deleted
  - WebSocket connection events
  - Errors with helpful messages
- Auto-dismiss after 3-5 seconds
- Dismissible manually
- Queue multiple notifications

**Benefits:**
- Clear feedback for all user actions
- Better error visibility
- Professional UX
- Non-blocking notifications

**Implementation Estimate:** 3-4 hours
- Frontend: Toast component, notification store, integration across views

**Priority:** ⭐⭐⭐⭐⭐ (Major UX improvement)

---

### 4. Dashboard Cloning

**Problem:** Creating similar dashboards requires manual recreation of all panels.

**Proposed Solution:**
- "Clone" button on dashboard list cards
- Creates duplicate with " (Copy)" appended to name
- Copies all panels and configurations
- Opens cloned dashboard immediately

**Benefits:**
- Faster dashboard creation for variations
- Easy experimentation without losing original
- Common user request

**Implementation Estimate:** 2-3 hours
- Backend: Clone endpoint or use existing GET + POST
- Frontend: Clone button, API integration, navigation

**Priority:** ⭐⭐⭐⭐ (High value, quick win)

---

## Medium Priority (High Impact, Medium Effort)

### 5. Dashboard Export/Import

**Problem:** No way to backup, share, or migrate dashboard configurations.

**Proposed Solution:**
- Export dashboard to JSON file (includes panels, not feed definitions)
- Import dashboard from JSON file
- Buttons on dashboard list and detail views
- Validate import JSON structure
- Option to include feed definitions in export

**Benefits:**
- Easy backup and restore
- Share dashboards with team/community
- Migration between environments
- Configuration version control

**Implementation Estimate:** 5-7 hours
- Backend: Export/import endpoints with validation
- Frontend: File upload/download, UI integration

**Priority:** ⭐⭐⭐⭐ (Valuable for teams)

---

### 6. Additional Panel Types

**Problem:** Limited panel types (only stat, timeseries, bar).

**Proposed Solution:**
- **Gauge Panel:** Circular gauge with min/max/target ranges
  - Use ECharts gauge chart
  - Configurable color zones (red/yellow/green)
  - Ideal for percentages (CPU, disk, progress)

- **Table Panel:** Tabular data display
  - Show multiple metrics in rows
  - Support for nested data structures
  - Sortable columns

- **Heatmap Panel:** Time-series heatmap
  - Show intensity over time
  - Good for daily/hourly patterns

**Benefits:**
- More visualization options
- Better data representation
- Competitive with other dashboards

**Implementation Estimate:** 8-12 hours (2-4 hours per panel type)
- Frontend: New panel components, ECharts configurations

**Priority:** ⭐⭐⭐⭐ (Expands use cases)

---

### 7. Panel Settings Dialog

**Problem:** Panel customization is limited to feed_key.

**Proposed Solution:**
- Settings dialog for each panel type
- Common settings:
  - Title and description
  - Refresh rate override
  - Color scheme selection
  - Size and position (with grid preview)
- Type-specific settings:
  - Chart colors, axis labels, legends
  - Stat panel: units, decimal places, trend calculation
  - Timeseries: line style, fill, smoothing
  - Bar: orientation, stack mode

**Benefits:**
- Personalized panel appearance
- Better data presentation
- More professional dashboards

**Implementation Estimate:** 6-8 hours
- Frontend: Settings dialog component, panel customization logic

**Priority:** ⭐⭐⭐⭐ (Polish feature)

---

## Lower Priority (Medium Impact, Low-Medium Effort)

### 8. Dark/Light Mode Toggle

**Status:** Already mentioned in UI_IMPROVEMENTS.md

**Proposed Solution:**
- Theme toggle in header
- Store preference in localStorage
- CSS variable-based theming
- Smooth transition between themes
- Light theme color palette design

**Implementation Estimate:** 4-6 hours
- Frontend: Theme store, CSS variables, toggle UI

**Priority:** ⭐⭐⭐ (Nice to have)

---

### 9. Keyboard Shortcuts

**Proposed Solution:**
- `?` - Show keyboard shortcut help
- `n` - New dashboard
- `g h` - Go home (dashboard list)
- `g d` - Go to dashboard (with search)
- `r` - Refresh current dashboard
- `Esc` - Close dialogs
- `Ctrl+S` - Save (if editing)

**Benefits:**
- Power user efficiency
- Accessibility improvement
- Professional feel

**Implementation Estimate:** 3-5 hours
- Frontend: Keyboard event handlers, help modal

**Priority:** ⭐⭐⭐ (Power user feature)

---

### 10. Dashboard Search and Filtering

**Proposed Solution:**
- Search bar on dashboard list
- Filter by:
  - Name (fuzzy search)
  - Feed type used
  - Creation date
  - Number of panels
- Sort options: Name, Date created, Date updated

**Benefits:**
- Easier navigation with many dashboards
- Quick dashboard discovery
- Better organization

**Implementation Estimate:** 3-4 hours
- Frontend: Search input, filter logic, sort controls

**Priority:** ⭐⭐⭐ (Scales with usage)

---

### 11. Feed Data History Chart

**Proposed Solution:**
- View page for individual feeds
- Historical data chart showing feed values over time
- Useful for debugging feed issues
- Show last fetch time, error count, uptime

**Benefits:**
- Feed monitoring and debugging
- Validate feed reliability
- Identify data quality issues

**Implementation Estimate:** 4-5 hours
- Frontend: Feed detail view, history chart component

**Priority:** ⭐⭐⭐ (Developer/admin feature)

---

## Future Enhancements (Lower Priority)

### 12. Panel Templates
- Save panel configurations as templates
- Quick create from template library
- Share templates

**Priority:** ⭐⭐ (Nice to have)

---

### 13. Alerting System
- Set thresholds on feeds
- Email/webhook notifications
- Alert history

**Priority:** ⭐⭐⭐ (Production feature)
**Effort:** High (10-15 hours)

---

### 14. User Authentication
- Login/signup system
- User-specific dashboards
- Role-based access control

**Priority:** ⭐⭐⭐⭐⭐ (Required for public deployment)
**Effort:** Very High (20-30 hours)

---

### 15. Multi-Tenancy
- Separate data per organization
- Team collaboration features
- Sharing permissions

**Priority:** ⭐⭐⭐ (Enterprise feature)
**Effort:** Very High (30+ hours)

---

## Implementation Recommendation

### Immediate Next Steps (Phase 5 - Polish)

Implement these 4 features to complete the UX:

1. **Panel Management UI** (⭐⭐⭐⭐⭐)
   - Add panel dialog
   - Delete panel with confirmation
   - Edit panel settings

2. **WebSocket Status Indicator** (⭐⭐⭐⭐⭐)
   - Connection status display
   - Reconnection feedback
   - Manual reconnect

3. **Toast Notifications** (⭐⭐⭐⭐⭐)
   - Success/error messages
   - User feedback for all operations

4. **Dashboard Cloning** (⭐⭐⭐⭐)
   - Quick duplicate feature
   - Easy experimentation

**Total Estimated Effort:** 11-16 hours
**Impact:** Completes production-ready UX for general users

### Follow-up Features (Phase 6 - Enhancement)

After Phase 5, consider:

5. **Dashboard Export/Import** (backup/sharing)
6. **Additional Panel Types** (gauge, table)
7. **Panel Settings Dialog** (customization)

---

## Evaluation Criteria

Each proposal evaluated on:
- **Impact:** How much value does this add?
- **Effort:** How long to implement?
- **Risk:** Complexity and potential issues
- **Dependencies:** What must exist first?

**Priority Scale:**
- ⭐⭐⭐⭐⭐ Critical - Major UX gap or blocker
- ⭐⭐⭐⭐ High - Significant value add
- ⭐⭐⭐ Medium - Nice to have
- ⭐⭐ Low - Future consideration

---

**Document Version:** 1.0
**Date:** 2024-11-19
**Status:** Proposed
