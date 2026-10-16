import { describe, it, expect, beforeEach, vi } from 'vitest'
import apiClient from '../../api/client'

// ApiClient class is not a named export of ../../api/client; derive it from
// the singleton's constructor so the tests below exercise real instances
// without modifying src/api/client.ts.
const ApiClient = apiClient.constructor as new (baseUrl?: string) => typeof apiClient

describe('ApiClient credited paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
  })

  it('resolves undefined for DELETE with 204 No Content', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 204,
    })

    await expect(apiClient.deleteDashboard('d1')).resolves.toBeUndefined()

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/dashboards/d1'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('rejects with the backend detail message on error', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'Bad' }),
    })

    await expect(apiClient.getDashboards()).rejects.toThrow('Bad')
  })

  it('maps https to wss and http to ws for dashboard sockets', () => {
    expect(new ApiClient('https://api.example.com').getWebSocketUrl('d')).toBe(
      'wss://api.example.com/ws/dashboards/d'
    )
    expect(new ApiClient('http://api.example.com:8000').getWebSocketUrl('d')).toBe(
      'ws://api.example.com:8000/ws/dashboards/d'
    )
  })
})
