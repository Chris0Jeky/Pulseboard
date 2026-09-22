import { beforeEach, describe, expect, it, vi } from 'vitest'
import apiClient from '../api/client'
import { createMockDashboard, createMockPanel, createTestPinia } from '../test/helpers'
import { useDashboardsStore } from './dashboards'

vi.mock('../api/client')

describe('dashboard update detail preservation', () => {
  beforeEach(() => {
    createTestPinia()
    vi.clearAllMocks()
  })

  it('preserves loaded panels when the update response omits them', async () => {
    const store = useDashboardsStore()
    const panel = createMockPanel()
    const detailed = createMockDashboard({ id: 'dashboard-1', name: 'Before', panels: [panel] })
    const updated = createMockDashboard({ id: 'dashboard-1', name: 'After', panels: undefined })
    store.currentDashboard = detailed
    store.dashboards = [detailed]
    vi.spyOn(apiClient, 'updateDashboard').mockResolvedValue(updated)

    await store.updateDashboard('dashboard-1', { name: 'After' })

    expect(store.currentDashboard?.name).toBe('After')
    expect(store.currentDashboard?.panels).toEqual([panel])
    expect(store.dashboards[0]?.name).toBe('After')
  })
})
