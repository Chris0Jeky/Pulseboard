/**
 * API client for Pulseboard backend
 */

import type {
  Dashboard,
  DashboardCreate,
  DashboardUpdate,
  FeedDefinition,
  FeedCreate,
  Panel,
  PanelCreate,
  PanelUpdate,
} from '../types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T
    }

    return response.json()
  }

  // Dashboard endpoints
  async getDashboards(): Promise<Dashboard[]> {
    return this.request<Dashboard[]>('/api/dashboards')
  }

  async getDashboard(id: string): Promise<Dashboard> {
    return this.request<Dashboard>(`/api/dashboards/${id}`)
  }

  async createDashboard(data: DashboardCreate): Promise<Dashboard> {
    return this.request<Dashboard>('/api/dashboards', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateDashboard(id: string, data: DashboardUpdate): Promise<Dashboard> {
    return this.request<Dashboard>(`/api/dashboards/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteDashboard(id: string): Promise<void> {
    return this.request<void>(`/api/dashboards/${id}`, {
      method: 'DELETE',
    })
  }

  async getDashboardFeedIds(id: string): Promise<string[]> {
    return this.request<string[]>(`/api/dashboards/${id}/feed-ids`)
  }

  // Feed endpoints
  async getFeeds(): Promise<FeedDefinition[]> {
    return this.request<FeedDefinition[]>('/api/feeds')
  }

  async getFeed(id: string): Promise<FeedDefinition> {
    return this.request<FeedDefinition>(`/api/feeds/${id}`)
  }

  async createFeed(data: FeedCreate): Promise<FeedDefinition> {
    return this.request<FeedDefinition>('/api/feeds', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updateFeed(id: string, data: Partial<FeedCreate>): Promise<FeedDefinition> {
    return this.request<FeedDefinition>(`/api/feeds/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deleteFeed(id: string): Promise<void> {
    return this.request<void>(`/api/feeds/${id}`, {
      method: 'DELETE',
    })
  }

  // Panel endpoints
  async createPanel(dashboardId: string, data: PanelCreate): Promise<Panel> {
    return this.request<Panel>(`/api/dashboards/${dashboardId}/panels`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async updatePanel(dashboardId: string, panelId: string, data: PanelUpdate): Promise<Panel> {
    return this.request<Panel>(`/api/dashboards/${dashboardId}/panels/${panelId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  }

  async deletePanel(dashboardId: string, panelId: string): Promise<void> {
    return this.request<void>(`/api/dashboards/${dashboardId}/panels/${panelId}`, {
      method: 'DELETE',
    })
  }

  // WebSocket URL
  getWebSocketUrl(dashboardId: string): string {
    const wsProtocol = this.baseUrl.startsWith('https') ? 'wss' : 'ws'
    const wsBase = this.baseUrl.replace(/^https?:\/\//, '')
    return `${wsProtocol}://${wsBase}/ws/dashboards/${dashboardId}`
  }
}

export const apiClient = new ApiClient()
export default apiClient
