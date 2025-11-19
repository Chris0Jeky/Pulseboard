<template>
  <div class="min-h-screen">
    <!-- Header -->
    <div class="header-gradient border-b border-white/10 backdrop-blur-sm sticky top-0 z-40">
      <div class="max-w-full px-4 sm:px-6 lg:px-8 py-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <router-link
              :to="{ name: 'dashboards' }"
              class="flex items-center gap-2 text-gray-300 hover:text-white transition-colors group"
            >
              <svg class="w-5 h-5 group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </router-link>
            <div>
              <h1 class="text-3xl font-bold text-white tracking-tight">
                {{ dashboard?.name || 'Loading...' }}
              </h1>
              <p v-if="dashboard?.description" class="text-gray-400 mt-1">
                {{ dashboard.description }}
              </p>
            </div>
          </div>

          <div class="flex items-center gap-4">
            <!-- WebSocket status indicator -->
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
              <div
                class="w-2.5 h-2.5 rounded-full animate-pulse"
                :class="{
                  'bg-green-500': wsStatus === 'connected',
                  'bg-yellow-500': wsStatus === 'connecting',
                  'bg-red-500': wsStatus === 'disconnected' || wsStatus === 'error',
                }"
              />
              <span class="text-sm font-medium text-gray-300">
                {{ wsStatusText }}
              </span>
            </div>

            <!-- Add Panel Button -->
            <button @click="showPanelDialog = true" class="btn-primary-modern">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Add Panel
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Dashboard content -->
    <div class="max-w-full px-4 sm:px-6 lg:px-8 py-6">
      <!-- Loading state -->
      <div v-if="loading" class="text-center py-12">
        <div class="text-gray-400">Loading dashboard...</div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="text-center py-12">
        <div class="text-red-400">{{ error }}</div>
        <button @click="loadDashboard" class="btn-secondary mt-4">
          Retry
        </button>
      </div>

      <!-- Empty dashboard -->
      <div v-else-if="!dashboard || !dashboard.panels || dashboard.panels.length === 0" class="text-center py-12">
        <div class="text-gray-400 mb-4">This dashboard has no panels yet</div>
        <button @click="showPanelDialog = true" class="btn-primary">
          Add your first panel
        </button>
      </div>

      <!-- Panel grid -->
      <div v-else class="grid grid-cols-12 gap-4 auto-rows-[150px]">
        <div
          v-for="panel in dashboard.panels"
          :key="panel.id"
          :style="getPanelStyle(panel)"
          class="min-h-0 relative group"
        >
          <!-- Panel Component -->
          <component
            :is="getPanelComponent(panel.type)"
            :title="panel.title"
            :feed-ids="parseFeedIds(panel.feed_ids_json)"
            :options="parseOptions(panel.options_json)"
          />

          <!-- Panel Controls (visible on hover) -->
          <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
            <button
              @click="editPanel(panel)"
              class="p-1 bg-gray-800 hover:bg-gray-700 rounded text-gray-300 hover:text-white"
              title="Edit panel"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              @click="confirmDeletePanel(panel)"
              class="p-1 bg-gray-800 hover:bg-red-600 rounded text-gray-300 hover:text-white"
              title="Delete panel"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Panel Dialog -->
    <PanelDialog
      :show="showPanelDialog"
      :panel="editingPanel"
      :available-feeds="availableFeeds"
      @close="closePanelDialog"
      @submit="handlePanelSubmit"
    />

    <!-- Delete Confirmation Dialog -->
    <div
      v-if="showDeleteConfirm"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      @click.self="showDeleteConfirm = false"
    >
      <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
        <h2 class="text-xl font-bold text-white mb-4">Delete Panel</h2>
        <p class="text-gray-300 mb-6">
          Are you sure you want to delete "{{ deletingPanel?.title }}"? This action cannot be undone.
        </p>
        <div class="flex gap-3">
          <button
            @click="handleDeletePanel"
            class="btn-primary flex-1 bg-red-600 hover:bg-red-700"
            :disabled="deleting"
          >
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
          <button
            @click="showDeleteConfirm = false"
            class="btn-secondary flex-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDashboardsStore } from '../stores/dashboards'
import { useUiStore } from '../stores/ui'
import { useDashboardWebSocket } from '../composables/useDashboardWebSocket'
import PanelStat from '../components/panels/PanelStat.vue'
import PanelTimeseries from '../components/panels/PanelTimeseries.vue'
import PanelBar from '../components/panels/PanelBar.vue'
import PanelDialog from '../components/PanelDialog.vue'
import apiClient from '../api/client'
import type { Panel, PanelOptions, PanelCreate, FeedDefinition } from '../types'

const route = useRoute()
const dashboardsStore = useDashboardsStore()
const uiStore = useUiStore()

const dashboardId = computed(() => route.params.id as string)
const dashboard = computed(() => dashboardsStore.currentDashboard)
const loading = computed(() => dashboardsStore.loading)
const error = computed(() => dashboardsStore.error)
const wsStatus = computed(() => uiStore.wsStatus)

const { connect, disconnect } = useDashboardWebSocket(dashboardId.value)

const wsStatusText = computed(() => {
  switch (wsStatus.value) {
    case 'connected':
      return 'Live'
    case 'connecting':
      return 'Connecting...'
    case 'disconnected':
      return 'Disconnected'
    case 'error':
      return 'Error'
    default:
      return 'Unknown'
  }
})

// Panel management state
const showPanelDialog = ref(false)
const editingPanel = ref<Panel | null>(null)
const showDeleteConfirm = ref(false)
const deletingPanel = ref<Panel | null>(null)
const deleting = ref(false)
const availableFeeds = ref<FeedDefinition[]>([])

async function loadDashboard() {
  await dashboardsStore.fetchDashboard(dashboardId.value)
}

async function loadFeeds() {
  try {
    availableFeeds.value = await apiClient.getFeeds()
  } catch (e) {
    console.error('Failed to load feeds:', e)
  }
}

function editPanel(panel: Panel) {
  editingPanel.value = panel
  showPanelDialog.value = true
}

function confirmDeletePanel(panel: Panel) {
  deletingPanel.value = panel
  showDeleteConfirm.value = true
}

function closePanelDialog() {
  showPanelDialog.value = false
  editingPanel.value = null
}

async function handlePanelSubmit(data: PanelCreate) {
  try {
    if (editingPanel.value) {
      // Update existing panel
      await apiClient.updatePanel(dashboardId.value, editingPanel.value.id, data)
    } else {
      // Create new panel
      await apiClient.createPanel(dashboardId.value, data)
    }

    // Reload dashboard to show changes
    await loadDashboard()
    closePanelDialog()
  } catch (e) {
    console.error('Failed to save panel:', e)
    alert('Failed to save panel: ' + (e instanceof Error ? e.message : 'Unknown error'))
  }
}

async function handleDeletePanel() {
  if (!deletingPanel.value) return

  deleting.value = true
  try {
    await apiClient.deletePanel(dashboardId.value, deletingPanel.value.id)
    await loadDashboard()
    showDeleteConfirm.value = false
    deletingPanel.value = null
  } catch (e) {
    console.error('Failed to delete panel:', e)
    alert('Failed to delete panel: ' + (e instanceof Error ? e.message : 'Unknown error'))
  } finally {
    deleting.value = false
  }
}

function getPanelComponent(type: string) {
  switch (type) {
    case 'stat':
      return PanelStat
    case 'timeseries':
      return PanelTimeseries
    case 'bar':
      return PanelBar
    default:
      return PanelStat
  }
}

function getPanelStyle(panel: Panel) {
  return {
    gridColumn: `span ${panel.width}`,
    gridRow: `span ${panel.height}`,
  }
}

function parseFeedIds(json: string): string[] {
  try {
    return JSON.parse(json)
  } catch {
    return []
  }
}

function parseOptions(json: string): PanelOptions {
  try {
    return JSON.parse(json)
  } catch {
    return {}
  }
}

onMounted(async () => {
  await Promise.all([
    loadDashboard(),
    loadFeeds(),
  ])

  // Connect to WebSocket after dashboard is loaded
  if (!error.value) {
    connect()
  }
})

onUnmounted(() => {
  disconnect()
  dashboardsStore.clearCurrentDashboard()
})

// Reconnect if dashboard changes
watch(dashboardId, async () => {
  disconnect()
  await loadDashboard()
  if (!error.value) {
    connect()
  }
})
</script>
