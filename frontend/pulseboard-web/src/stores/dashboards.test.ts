import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDashboardsStore } from './dashboards'
import { createTestPinia, createMockDashboard, createMockFetchResponse } from '../test/helpers'
import apiClient from '../api/client'

vi.mock('../api/client')

describe('Dashboards Store', () => {
  beforeEach(() => {
    createTestPinia()
    vi.clearAllMocks()
  })

  describe('fetchDashboards', () => {
    it('should fetch and store dashboards', async () => {
      const store = useDashboardsStore()
      const mockDashboards = [
        createMockDashboard({ id: '1', name: 'Dashboard 1' }),
        createMockDashboard({ id: '2', name: 'Dashboard 2' }),
      ]

      vi.spyOn(apiClient, 'getDashboards').mockResolvedValue(mockDashboards)

      await store.fetchDashboards()

      expect(store.dashboards).toEqual(mockDashboards)
      expect(store.loading).toBe(false)
      expect(store.error).toBeNull()
    })

    it('should set loading state during fetch', async () => {
      const store = useDashboardsStore()

      vi.spyOn(apiClient, 'getDashboards').mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve([]), 100))
      )

      const promise = store.fetchDashboards()
      expect(store.loading).toBe(true)

      await promise
      expect(store.loading).toBe(false)
    })

    it('should handle fetch errors', async () => {
      const store = useDashboardsStore()
      const errorMessage = 'Network error'

      vi.spyOn(apiClient, 'getDashboards').mockRejectedValue(new Error(errorMessage))

      await store.fetchDashboards()

      expect(store.error).toBe(errorMessage)
      expect(store.dashboards).toEqual([])
      expect(store.loading).toBe(false)
    })
  })

  describe('fetchDashboard', () => {
    it('should fetch and store single dashboard', async () => {
      const store = useDashboardsStore()
      const mockDashboard = createMockDashboard({ id: 'test-id' })

      vi.spyOn(apiClient, 'getDashboard').mockResolvedValue(mockDashboard)

      await store.fetchDashboard('test-id')

      expect(store.currentDashboard).toEqual(mockDashboard)
      expect(apiClient.getDashboard).toHaveBeenCalledWith('test-id')
    })

    it('should handle errors and re-throw', async () => {
      const store = useDashboardsStore()
      const error = new Error('Not found')

      vi.spyOn(apiClient, 'getDashboard').mockRejectedValue(error)

      await expect(store.fetchDashboard('invalid-id')).rejects.toThrow('Not found')
      expect(store.error).toBe('Not found')
      expect(store.currentDashboard).toBeNull()
    })
  })

  describe('createDashboard', () => {
    it('should create dashboard and add to store', async () => {
      const store = useDashboardsStore()
      const newDashboard = createMockDashboard({ name: 'New Dashboard' })

      vi.spyOn(apiClient, 'createDashboard').mockResolvedValue(newDashboard)

      const result = await store.createDashboard('New Dashboard', 'Description')

      expect(result).toEqual(newDashboard)
      expect(store.dashboards).toContainEqual(newDashboard)
      expect(apiClient.createDashboard).toHaveBeenCalledWith({
        name: 'New Dashboard',
        description: 'Description',
      })
    })

    it('should handle creation errors', async () => {
      const store = useDashboardsStore()

      vi.spyOn(apiClient, 'createDashboard').mockRejectedValue(new Error('Creation failed'))

      await expect(store.createDashboard('Test')).rejects.toThrow('Creation failed')
      expect(store.error).toBe('Creation failed')
    })
  })

  describe('updateDashboard', () => {
    it('should update dashboard in store', async () => {
      const store = useDashboardsStore()
      const existing = createMockDashboard({ id: '1', name: 'Old Name' })
      const updated = createMockDashboard({ id: '1', name: 'New Name' })

      store.dashboards = [existing]
      vi.spyOn(apiClient, 'updateDashboard').mockResolvedValue(updated)

      const result = await store.updateDashboard('1', { name: 'New Name' })

      expect(result).toEqual(updated)
      expect(store.dashboards[0].name).toBe('New Name')
    })
  })

  describe('deleteDashboard', () => {
    it('should remove dashboard from store', async () => {
      const store = useDashboardsStore()
      const dashboard1 = createMockDashboard({ id: '1' })
      const dashboard2 = createMockDashboard({ id: '2' })

      store.dashboards = [dashboard1, dashboard2]
      vi.spyOn(apiClient, 'deleteDashboard').mockResolvedValue(undefined)

      await store.deleteDashboard('1')

      expect(store.dashboards).toEqual([dashboard2])
      expect(store.dashboards.length).toBe(1)
    })

    it('should handle deletion errors', async () => {
      const store = useDashboardsStore()

      vi.spyOn(apiClient, 'deleteDashboard').mockRejectedValue(new Error('Delete failed'))

      await expect(store.deleteDashboard('1')).rejects.toThrow('Delete failed')
    })
  })
})
