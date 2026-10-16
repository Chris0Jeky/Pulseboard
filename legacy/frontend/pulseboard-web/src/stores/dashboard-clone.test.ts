import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDashboardsStore } from './dashboards'
import { createTestPinia, createMockDashboard, createMockPanel } from '../test/helpers'
import apiClient from '../api/client'

vi.mock('../api/client')

describe('cloneDashboard panel cloning regression', () => {
  beforeEach(() => {
    createTestPinia()
    vi.clearAllMocks()
  })

  it('creates one panel per source panel in the cloned dashboard', async () => {
    const store = useDashboardsStore()
    const panel1 = createMockPanel({ id: 'panel-1', title: 'Panel 1' })
    const panel2 = createMockPanel({ id: 'panel-2', title: 'Panel 2' })
    const source = createMockDashboard({
      id: 'source-1',
      name: 'Source',
      description: 'Source description',
      panels: [panel1, panel2],
    })
    const created = createMockDashboard({ id: 'new-1', name: 'Source (Copy)' })
    const cloned = createMockDashboard({
      id: 'new-1',
      name: 'Source (Copy)',
      description: 'Source description',
      panels: [panel1, panel2],
    })

    vi.spyOn(apiClient, 'getDashboard').mockImplementation(async (id: string) =>
      id === 'new-1' ? cloned : source
    )
    vi.spyOn(apiClient, 'createDashboard').mockResolvedValue(created)
    vi.spyOn(apiClient, 'createPanel').mockResolvedValue(panel1)

    const result = await store.cloneDashboard('source-1')

    expect(apiClient.createPanel).toHaveBeenCalledTimes(2)
    for (const panel of [panel1, panel2]) {
      expect(apiClient.createPanel).toHaveBeenCalledWith('new-1', {
        title: panel.title,
        type: panel.type,
        feed_ids_json: panel.feed_ids_json,
        options_json: panel.options_json,
        position_x: panel.position_x,
        position_y: panel.position_y,
        width: panel.width,
        height: panel.height,
      })
    }
    expect(result).toEqual(cloned)
  })
  it('preserves panels when updating dashboard metadata', async () => {
    const store = useDashboardsStore()
    const panels = [createMockPanel({ id: 'panel-1' })]
    const source = createMockDashboard({ id: 'source-1', panels })
    store.currentDashboard = source
    store.dashboards = [source]
    const { panels: _panels, ...updated } = { ...source, name: 'Renamed' }
    vi.spyOn(apiClient, 'updateDashboard').mockResolvedValue(updated)

    const result = await store.updateDashboard('source-1', { name: 'Renamed' })

    expect(store.currentDashboard).toEqual({ ...updated, panels })
    expect(store.dashboards[0]).toEqual({ ...updated, panels })
    expect(result).toEqual({ ...updated, panels })
  })

})
