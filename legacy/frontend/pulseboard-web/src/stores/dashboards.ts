/**
 * Dashboards store
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Dashboard, DashboardUpdate } from '../types'
import apiClient from '../api/client'
import { useNotificationsStore } from './notifications'

export const useDashboardsStore = defineStore('dashboards', () => {
  // State
  const dashboards = ref<Dashboard[]>([])
  const currentDashboard = ref<Dashboard | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const notifications = useNotificationsStore()

  // Actions
  async function fetchDashboards() {
    loading.value = true
    error.value = null

    try {
      dashboards.value = await apiClient.getDashboards()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch dashboards'
      notifications.error(error.value)
      console.error('Error fetching dashboards:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchDashboard(id: string) {
    loading.value = true
    error.value = null

    try {
      currentDashboard.value = await apiClient.getDashboard(id)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch dashboard'
      notifications.error(error.value)
      console.error('Error fetching dashboard:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function createDashboard(name: string, description?: string) {
    loading.value = true
    error.value = null

    try {
      const dashboard = await apiClient.createDashboard({ name, description })
      dashboards.value.push(dashboard)
      notifications.success(`Dashboard "${name}" created successfully`)
      return dashboard
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create dashboard'
      notifications.error(error.value)
      console.error('Error creating dashboard:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function updateDashboard(id: string, data: DashboardUpdate) {
    loading.value = true
    error.value = null

    try {
      const updated = await apiClient.updateDashboard(id, data)
      const preserveDetails = (existing: Dashboard | null | undefined): Dashboard =>
        existing?.panels === undefined
          ? updated
          : { ...existing, ...updated, panels: existing.panels }
      const index = dashboards.value.findIndex((dashboard) => dashboard.id === id)
      if (index >= 0) {
        dashboards.value[index] = preserveDetails(dashboards.value[index])
      }
      if (currentDashboard.value?.id === id) {
        currentDashboard.value = preserveDetails(currentDashboard.value)
      }
      notifications.success(`Dashboard "${updated.name}" updated successfully`)
      return currentDashboard.value?.id === id ? currentDashboard.value : updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update dashboard'
      notifications.error(error.value)
      console.error('Error updating dashboard:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deleteDashboard(id: string) {
    loading.value = true
    error.value = null

    try {
      const dashboard = dashboards.value.find((d) => d.id === id)
      await apiClient.deleteDashboard(id)
      dashboards.value = dashboards.value.filter((d) => d.id !== id)
      if (currentDashboard.value?.id === id) {
        currentDashboard.value = null
      }
      notifications.success(`Dashboard "${dashboard?.name || 'Unknown'}" deleted`)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete dashboard'
      notifications.error(error.value)
      console.error('Error deleting dashboard:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function cloneDashboard(id: string) {
    loading.value = true
    error.value = null

    try {
      // Get the source dashboard with all panels
      const source = await apiClient.getDashboard(id)

      // Create new dashboard with "(Copy)" suffix
      const clonedDashboard = await apiClient.createDashboard({
        name: `${source.name} (Copy)`,
        description: source.description || undefined,
      })

      // Clone all panels
      for (const panel of source.panels || []) {
        await apiClient.createPanel(clonedDashboard.id, {
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

      // Fetch the cloned dashboard with panels
      const clonedWithPanels = await apiClient.getDashboard(clonedDashboard.id)

      // Add to dashboards list
      dashboards.value.push(clonedWithPanels)

      notifications.success(`Dashboard "${source.name}" cloned successfully`)
      return clonedWithPanels
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to clone dashboard'
      notifications.error(error.value)
      throw e
    } finally {
      loading.value = false
    }
  }

  function clearCurrentDashboard() {
    currentDashboard.value = null
  }

  return {
    // State
    dashboards,
    currentDashboard,
    loading,
    error,

    // Actions
    fetchDashboards,
    fetchDashboard,
    createDashboard,
    updateDashboard,
    deleteDashboard,
    cloneDashboard,
    clearCurrentDashboard,
  }
})
