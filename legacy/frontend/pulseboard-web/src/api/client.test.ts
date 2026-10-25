import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { apiClient } from './client'
import { createMockFetchResponse, createMockDashboard, createMockFeed, createMockPanel } from '../test/helpers'

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

  describe('getDashboardFeedIds', () => {
    it('should fetch dashboard feed ids without method override', async () => {
      const mockIds = ['feed-1', 'feed-2']
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(mockIds)
      )

      const result = await apiClient.getDashboardFeedIds('d1')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards/d1/feed-ids'),
        expect.anything()
      )
      expect((global.fetch as any).mock.calls[0][1].method).toBeUndefined()
      expect(result).toEqual(mockIds)
    })
  })

  describe('createPanel', () => {
    it('should create panel with correct URL, verb and body', async () => {
      const payload = { type: 'stat', title: 'New Panel' }
      const created = createMockPanel({ type: payload.type, title: payload.title })
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(created)
      )

      const result = await apiClient.createPanel('d1', payload)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards/d1/panels'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      )
      expect(result).toEqual(created)
    })
  })

  describe('updatePanel', () => {
    it('should update panel with correct URL, verb and body', async () => {
      const update = { title: 'Updated Panel' }
      const updated = createMockPanel({ id: 'p1', title: update.title })
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(updated)
      )

      const result = await apiClient.updatePanel('d1', 'p1', update)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards/d1/panels/p1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(update),
        })
      )
      expect(result).toEqual(updated)
    })
  })

  describe('deletePanel', () => {
    it('should delete panel with correct URL and verb', async () => {
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(undefined, 204)
      )

      await apiClient.deletePanel('d1', 'p1')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards/d1/panels/p1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('createFeed', () => {
    it('should create feed with correct URL, verb and body', async () => {
      const payload = { type: 'system_metrics', name: 'New Feed' }
      const created = createMockFeed({ type: payload.type, name: payload.name })
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(created)
      )

      const result = await apiClient.createFeed(payload)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(payload),
        })
      )
      expect(result).toEqual(created)
    })
  })

  describe('updateFeed', () => {
    it('should update feed with correct URL, verb and body', async () => {
      const update = { name: 'Updated Feed' }
      const updated = createMockFeed({ id: 'f1', name: update.name })
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(updated)
      )

      const result = await apiClient.updateFeed('f1', update)

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds/f1'),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify(update),
        })
      )
      expect(result).toEqual(updated)
    })
  })

  describe('deleteFeed', () => {
    it('should delete feed with correct URL and verb', async () => {
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(undefined, 204)
      )

      await apiClient.deleteFeed('f1')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds/f1'),
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('getFeedTypes', () => {
    it('should fetch feed types without method override', async () => {
      const mockTypes = [
        { type: 'system_metrics', name: 'System Metrics', description: 'Host metrics', default_config: {} },
      ]
      ;(global.fetch as any).mockResolvedValue(
        createMockFetchResponse(mockTypes)
      )

      const result = await apiClient.getFeedTypes()

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/feeds/types'),
        expect.anything()
      )
      expect((global.fetch as any).mock.calls[0][1].method).toBeUndefined()
      expect(result).toEqual(mockTypes)
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

    it('should fall back on non-JSON error body and preserve custom headers', async () => {
      ;(global.fetch as any).mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON')
        },
      })

      await expect(
        (apiClient as any).request('/api/dashboards', {
          headers: { Authorization: 'Bearer x' },
        })
      ).rejects.toThrow('Unknown error')

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/dashboards'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer x',
          }),
        })
      )
    })

    it('should handle network errors', async () => {
      ;(global.fetch as any).mockRejectedValue(new Error('Network error'))

      await expect(apiClient.getDashboards()).rejects.toThrow('Network error')
    })
  })

  describe('getWebSocketUrl', () => {
    const originalBaseUrl = (apiClient as any).baseUrl

    afterEach(() => {
      ;(apiClient as any).baseUrl = originalBaseUrl
    })

    it('maps https to wss and strips scheme', () => {
      ;(apiClient as any).baseUrl = 'https://api.example.com'
      expect(apiClient.getWebSocketUrl('d1')).toBe('wss://api.example.com/ws/dashboards/d1')
    })

    it('maps http to ws and strips scheme', () => {
      ;(apiClient as any).baseUrl = 'http://localhost:8000'
      expect(apiClient.getWebSocketUrl('d1')).toBe('ws://localhost:8000/ws/dashboards/d1')
    })
  })
})
