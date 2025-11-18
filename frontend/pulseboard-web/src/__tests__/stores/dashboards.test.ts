/**
 * Unit tests for dashboards store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useDashboardsStore } from '../../stores/dashboards'
import apiClient from '../../api/client'
import type { Dashboard } from '../../types'

// Mock API client
vi.mock('../../api/client', () => ({
  default: {
    getDashboards: vi.fn(),
    getDashboard: vi.fn(),
    createDashboard: vi.fn(),
    deleteDashboard: vi.fn(),
  },
}))

describe('Dashboards Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('fetchDashboards', () => {
    it('should fetch and store dashboards', async () => {
      const mockDashboards: Dashboard[] = [
        {
          id: '1',
          name: 'Dashboard 1',
          description: 'Test',
          layout_json: '{}',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          name: 'Dashboard 2',
          description: null,
          layout_json: '{}',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(apiClient.getDashboards).mockResolvedValue(mockDashboards)

      const store = useDashboardsStore()
      await store.fetchDashboards()

      expect(store.dashboards).toEqual(mockDashboards)
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('should handle fetch error', async () => {
      vi.mocked(apiClient.getDashboards).mockRejectedValue(new Error('Network error'))

      const store = useDashboardsStore()
      await store.fetchDashboards()

      expect(store.dashboards).toEqual([])
      expect(store.loading).toBe(false)
      expect(store.error).toBe('Network error')
    })

    it('should set loading state', async () => {
      let resolvePromise: (value: Dashboard[]) => void
      const promise = new Promise<Dashboard[]>((resolve) => {
        resolvePromise = resolve
      })

      vi.mocked(apiClient.getDashboards).mockReturnValue(promise)

      const store = useDashboardsStore()
      const fetchPromise = store.fetchDashboards()

      expect(store.loading).toBe(true)

      resolvePromise!([])
      await fetchPromise

      expect(store.loading).toBe(false)
    })
  })

  describe('fetchDashboard', () => {
    it('should fetch and store current dashboard', async () => {
      const mockDashboard: Dashboard = {
        id: '1',
        name: 'Test Dashboard',
        description: 'Description',
        layout_json: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
        panels: [],
      }

      vi.mocked(apiClient.getDashboard).mockResolvedValue(mockDashboard)

      const store = useDashboardsStore()
      await store.fetchDashboard('1')

      expect(store.currentDashboard).toEqual(mockDashboard)
      expect(store.error).toBeNull()
    })

    it('should throw error on fetch failure', async () => {
      vi.mocked(apiClient.getDashboard).mockRejectedValue(new Error('Not found'))

      const store = useDashboardsStore()

      await expect(store.fetchDashboard('999')).rejects.toThrow('Not found')
      expect(store.error).toBe('Not found')
    })
  })

  describe('createDashboard', () => {
    it('should create and add dashboard to list', async () => {
      const newDashboard: Dashboard = {
        id: '3',
        name: 'New Dashboard',
        description: 'New Description',
        layout_json: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      vi.mocked(apiClient.createDashboard).mockResolvedValue(newDashboard)

      const store = useDashboardsStore()
      const result = await store.createDashboard('New Dashboard', 'New Description')

      expect(result).toEqual(newDashboard)
      expect(store.dashboards).toHaveLength(1)
      expect(store.dashboards[0]).toEqual(newDashboard)
    })

    it('should handle create error', async () => {
      vi.mocked(apiClient.createDashboard).mockRejectedValue(new Error('Create failed'))

      const store = useDashboardsStore()

      await expect(store.createDashboard('Test', 'Test')).rejects.toThrow('Create failed')
      expect(store.error).toBe('Create failed')
    })
  })

  describe('deleteDashboard', () => {
    it('should delete dashboard from list', async () => {
      const dashboards: Dashboard[] = [
        {
          id: '1',
          name: 'Dashboard 1',
          description: null,
          layout_json: '{}',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '2',
          name: 'Dashboard 2',
          description: null,
          layout_json: '{}',
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]

      vi.mocked(apiClient.deleteDashboard).mockResolvedValue(undefined)
      vi.mocked(apiClient.getDashboards).mockResolvedValue(dashboards)

      const store = useDashboardsStore()
      await store.fetchDashboards()

      await store.deleteDashboard('1')

      expect(store.dashboards).toHaveLength(1)
      expect(store.dashboards[0]!.id).toBe('2')
    })

    it('should clear current dashboard if deleted', async () => {
      vi.mocked(apiClient.deleteDashboard).mockResolvedValue(undefined)

      const store = useDashboardsStore()
      store.currentDashboard = {
        id: '1',
        name: 'Test',
        description: null,
        layout_json: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      await store.deleteDashboard('1')

      expect(store.currentDashboard).toBeNull()
    })
  })

  describe('clearCurrentDashboard', () => {
    it('should clear current dashboard', () => {
      const store = useDashboardsStore()
      store.currentDashboard = {
        id: '1',
        name: 'Test',
        description: null,
        layout_json: '{}',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }

      store.clearCurrentDashboard()

      expect(store.currentDashboard).toBeNull()
    })
  })
})
