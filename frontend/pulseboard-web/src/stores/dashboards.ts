/**
 * Dashboards store
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Dashboard } from '../types'
import apiClient from '../api/client'

export const useDashboardsStore = defineStore('dashboards', () => {
  // State
  const dashboards = ref<Dashboard[]>([])
  const currentDashboard = ref<Dashboard | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Actions
  async function fetchDashboards() {
    loading.value = true
    error.value = null

    try {
      dashboards.value = await apiClient.getDashboards()
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch dashboards'
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
      return dashboard
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create dashboard'
      console.error('Error creating dashboard:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function deleteDashboard(id: string) {
    loading.value = true
    error.value = null

    try {
      await apiClient.deleteDashboard(id)
      dashboards.value = dashboards.value.filter((d) => d.id !== id)
      if (currentDashboard.value?.id === id) {
        currentDashboard.value = null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete dashboard'
      console.error('Error deleting dashboard:', e)
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
    deleteDashboard,
    clearCurrentDashboard,
  }
})
