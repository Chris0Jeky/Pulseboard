import { describe, it, expect, beforeEach, vi } from 'vitest'
import { apiClient } from './client'
import { createMockFetchResponse, createMockDashboard, createMockFeed } from '../test/helpers'

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  describe('getDashboards', () => {
    it('should fetch dashboards successfully', async () => {
      const mockDashboards = [createMockDashboard()]
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(mockDashboards)
      )

      const result = await apiClient.getDashboards()

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      )
      expect(result).toEqual(mockDashboards)
    })

    it('should handle errors', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Server error' }),
      })

      await expect(apiClient.getDashboards()).rejects.toThrow()
    })
  })

  describe('createDashboard', () => {
    it('should create dashboard with correct payload', async () => {
      const newDashboard = { name: 'New Dashboard', description: 'Test' }
      const createdDashboard = createMockDashboard(newDashboard)
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(createdDashboard)
      )

      const result = await apiClient.createDashboard(newDashboard)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(newDashboard),
        })
      )
      expect(result).toEqual(createdDashboard)
    })
  })

  describe('updateDashboard', () => {
    it('should update dashboard', async () => {
      const update = { name: 'Updated Name' }
      const updated = createMockDashboard(update)
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(updated)
      )

      const result = await apiClient.updateDashboard('test-id', update)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards/test-id'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(update),
        })
      )
      expect(result).toEqual(updated)
    })
  })

  describe('deleteDashboard', () => {
    it('should delete dashboard', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: true,
        status: 204,
      })

      await apiClient.deleteDashboard('test-id')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards/test-id'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('getFeeds', () => {
    it('should fetch feeds', async () => {
      const mockFeeds = [createMockFeed()]
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(mockFeeds)
      )

      const result = await apiClient.getFeeds()

      expect(result).toEqual(mockFeeds)
    })
  })

  describe('testFeed', () => {
    it('should test feed and return results', async () => {
      const testResult = {
        success: true,
        data: { value: 42 },
        error: null,
        timestamp: '2025-01-01T00:00:00Z',
      }
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(testResult)
      )

      const result = await apiClient.testFeed('test-feed-id')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds/test-feed-id/test'),
        expect.objectContaining({
          method: 'POST',
        })
      )
      expect(result).toEqual(testResult)
    })
  })

  describe('error handling', () => {
    it('should handle 404 errors', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: 'Not found' }),
      })

      await expect(apiClient.getDashboard('non-existent')).rejects.toThrow('Not found')
    })

    it('should handle network errors', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      await expect(apiClient.getDashboards()).rejects.toThrow('Network error')
    })
  })
})
