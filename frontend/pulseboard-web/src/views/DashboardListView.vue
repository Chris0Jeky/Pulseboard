<template>
  <div class="min-h-screen">
    <!-- Hero Header -->
    <div class="header-gradient border-b border-white/10 backdrop-blur-sm">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div class="flex items-center justify-between">
          <div>
            <div class="flex items-center gap-3 mb-2">
              <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <h1 class="text-4xl font-bold text-white tracking-tight">Pulseboard</h1>
            </div>
            <p class="text-gray-400 ml-13">Real-time data visualization dashboards</p>
          </div>
          <div class="flex gap-3">
            <router-link
              :to="{ name: 'feeds' }"
              class="btn-secondary-modern"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
              Manage Feeds
            </router-link>
            <button @click="showCreateDialog = true" class="btn-primary-modern">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Create Dashboard
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      <!-- Loading state -->
      <div v-if="loading" class="text-center py-12">
        <div class="text-gray-400">Loading dashboards...</div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="text-center py-12">
        <div class="text-red-400">{{ error }}</div>
        <button @click="loadDashboards" class="btn-secondary mt-4">
          Retry
        </button>
      </div>

      <!-- Empty state -->
      <div v-else-if="dashboards.length === 0" class="text-center py-12">
        <div class="text-gray-400 mb-4">No dashboards yet</div>
        <button @click="showCreateDialog = true" class="btn-primary">
          Create your first dashboard
        </button>
      </div>

      <!-- Dashboard grid -->
      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div
          v-for="dashboard in dashboards"
          :key="dashboard.id"
          class="dashboard-card group"
        >
          <div class="flex items-start justify-between mb-3">
            <router-link
              :to="{ name: 'dashboard-live', params: { id: dashboard.id } }"
              class="flex items-center gap-3 flex-1 min-w-0"
            >
              <div class="w-10 h-10 bg-gradient-to-br from-blue-500/20 to-purple-600/20 rounded-lg flex items-center justify-center border border-blue-500/30">
                <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                </svg>
              </div>
              <div>
                <h2 class="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors">
                  {{ dashboard.name }}
                </h2>
              </div>
            </router-link>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                @click.stop="handleClone(dashboard.id)"
                class="p-2 rounded-lg hover:bg-blue-500/10 text-blue-400 hover:text-blue-300 transition-colors"
                title="Clone dashboard"
                :disabled="cloning === dashboard.id"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
              <button
                @click.stop="handleDelete(dashboard)"
                class="p-2 rounded-lg hover:bg-red-500/10 text-red-400 hover:text-red-300 transition-colors"
                title="Delete dashboard"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
          <p v-if="dashboard.description" class="text-gray-400 text-sm mb-4 line-clamp-2">
            {{ dashboard.description }}
          </p>
          <div class="flex items-center gap-4 text-xs text-gray-500">
            <div class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span>{{ dashboard.panels?.length || 0 }} panels</span>
            </div>
            <div class="flex items-center gap-1">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{{ formatDate(dashboard.updated_at) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Create dialog -->
      <div
        v-if="showCreateDialog"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="showCreateDialog = false"
      >
        <div class="bg-gradient-to-br from-gray-800/95 to-gray-900/95 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-purple-600/20 rounded-lg flex items-center justify-center border border-blue-500/30">
              <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 class="text-2xl font-bold text-white">Create Dashboard</h2>
          </div>

          <form @submit.prevent="handleCreate">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Name *
              </label>
              <input
                v-model="newDashboard.name"
                type="text"
                required
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="My Dashboard"
              />
            </div>

            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Description
              </label>
              <textarea
                v-model="newDashboard.description"
                rows="3"
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional description..."
              />
            </div>

            <div class="flex gap-3">
              <button type="submit" class="btn-primary-modern flex-1" :disabled="creating">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                {{ creating ? 'Creating...' : 'Create' }}
              </button>
              <button
                type="button"
                @click="showCreateDialog = false"
                class="btn-secondary-modern flex-1"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Delete Confirmation Dialog -->
      <div
        v-if="dashboardToDelete"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="dashboardToDelete = null"
      >
        <div class="bg-gradient-to-br from-gray-800/95 to-gray-900/95 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
              <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 class="text-xl font-bold text-white">Confirm Delete</h2>
          </div>
          <p class="text-gray-300 mb-6">
            Are you sure you want to delete "<span class="font-semibold text-white">{{ dashboardToDelete.name }}</span>"?
            This action cannot be undone.
          </p>
          <div class="flex gap-3">
            <button
              @click="confirmDelete"
              class="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-4 py-2.5 rounded-lg transition-all transform hover:-translate-y-0.5 shadow-lg hover:shadow-red-500/30"
              :disabled="deleting"
            >
              {{ deleting ? 'Deleting...' : 'Delete' }}
            </button>
            <button
              @click="dashboardToDelete = null"
              class="btn-secondary-modern flex-1"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardsStore } from '../stores/dashboards'
import type { Dashboard } from '../types'

const router = useRouter()
const dashboardsStore = useDashboardsStore()

const dashboards = computed(() => dashboardsStore.dashboards)
const loading = computed(() => dashboardsStore.loading)
const error = computed(() => dashboardsStore.error)

const showCreateDialog = ref(false)
const creating = ref(false)
const cloning = ref<string | null>(null)
const dashboardToDelete = ref<Dashboard | null>(null)
const deleting = ref(false)
const newDashboard = ref({
  name: '',
  description: '',
})

async function loadDashboards() {
  await dashboardsStore.fetchDashboards()
}

async function handleCreate() {
  if (!newDashboard.value.name.trim()) return

  creating.value = true
  try {
    const dashboard = await dashboardsStore.createDashboard(
      newDashboard.value.name,
      newDashboard.value.description || undefined
    )

    showCreateDialog.value = false
    newDashboard.value = { name: '', description: '' }

    // Navigate to new dashboard
    router.push({ name: 'dashboard-live', params: { id: dashboard.id } })
  } catch (e) {
    console.error('Failed to create dashboard:', e)
  } finally {
    creating.value = false
  }
}

async function handleClone(id: string) {
  cloning.value = id
  try {
    const cloned = await dashboardsStore.cloneDashboard(id)
    // Navigate to cloned dashboard
    router.push({ name: 'dashboard-live', params: { id: cloned.id } })
  } catch (e) {
    console.error('Failed to clone dashboard:', e)
  } finally {
    cloning.value = null
  }
}

function handleDelete(dashboard: Dashboard) {
  dashboardToDelete.value = dashboard
}

async function confirmDelete() {
  if (!dashboardToDelete.value) return

  deleting.value = true
  try {
    await dashboardsStore.deleteDashboard(dashboardToDelete.value.id)
    dashboardToDelete.value = null
  } catch (e) {
    console.error('Failed to delete dashboard:', e)
  } finally {
    deleting.value = false
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
  return date.toLocaleDateString()
}

onMounted(() => {
  loadDashboards()
})
</script>
