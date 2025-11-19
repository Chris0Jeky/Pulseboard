import { createPinia, setActivePinia } from 'pinia'
import type { Dashboard, Panel, FeedDefinition, FeedEventMessage } from '../types'

/**
 * Creates a fresh Pinia instance for each test
 */
export function createTestPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}

/**
 * Creates a mock dashboard for testing
 */
export function createMockDashboard(overrides?: Partial<Dashboard>): Dashboard {
  return {
    id: 'test-dashboard-1',
    name: 'Test Dashboard',
    description: 'A test dashboard',
    layout_json: '{"cols":12,"rowHeight":100}',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    panels: [],
    ...overrides,
  }
}

/**
 * Creates a mock panel for testing
 */
export function createMockPanel(overrides?: Partial<Panel>): Panel {
  return {
    id: 'test-panel-1',
    dashboard_id: 'test-dashboard-1',
    type: 'stat',
    title: 'Test Panel',
    feed_ids_json: '["feed-1"]',
    options_json: '{"field":"value"}',
    position_x: 0,
    position_y: 0,
    width: 4,
    height: 2,
    ...overrides,
  }
}

/**
 * Creates a mock feed definition for testing
 */
export function createMockFeed(overrides?: Partial<FeedDefinition>): FeedDefinition {
  return {
    id: 'test-feed-1',
    type: 'system_metrics',
    name: 'Test Feed',
    config_json: '{"interval_sec":5}',
    enabled: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Creates a mock feed event message for testing
 */
export function createMockFeedEvent(overrides?: Partial<FeedEventMessage>): FeedEventMessage {
  return {
    type: 'feed_update',
    feed_id: 'test-feed-1',
    ts: new Date().toISOString(),
    payload: { value: 42 },
    ...overrides,
  }
}

/**
 * Creates a mock fetch response
 */
export function createMockFetchResponse<T>(data: T, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as Response)
}
