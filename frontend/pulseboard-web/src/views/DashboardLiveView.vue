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
      <div v-else-if="!dashboard || !dashboard.panels || dashboard.panels.length === 0" class="text-center py-20">
        <div class="max-w-md mx-auto">
          <div class="w-16 h-16 bg-gradient-to-br from-blue-500/20 to-purple-600/20 rounded-2xl flex items-center justify-center border border-blue-500/30 mx-auto mb-4">
            <svg class="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-white mb-2">No panels yet</h3>
          <p class="text-gray-400 mb-6">Add your first panel to start visualizing data</p>
          <button @click="showPanelDialog = true" class="btn-primary-modern">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Add your first panel
          </button>
        </div>
      </div>

      <!-- Panel grid -->
      <div v-else class="grid grid-cols-12 gap-4 auto-rows-[150px] relative">
        <div
          v-for="panel in dashboard.panels"
          :key="panel.id"
          :style="getPanelStyle(panel)"
          :class="[
            'min-h-0 relative group panel-container',
            draggingPanelId === panel.id && 'opacity-50 scale-95',
            resizingPanelId === panel.id && 'ring-2 ring-blue-500'
          ]"
          @mousedown.stop
        >
          <!-- Drag Handle -->
          <div
            class="absolute top-0 left-0 right-0 h-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-move z-20"
            :class="draggingPanelId === panel.id ? 'opacity-100' : ''"
            @mousedown="startDrag($event, panel)"
            title="Drag to move"
          >
            <div class="px-3 py-1 bg-gray-800/90 rounded-b-lg border border-gray-700 flex items-center gap-2">
              <svg class="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 16 16">
                <path d="M7 2a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 5a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zM7 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm-3 3a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/>
              </svg>
              <span class="text-xs text-gray-400">Move</span>
            </div>
          </div>

          <!-- Panel Component -->
          <component
            :is="getPanelComponent(panel.type)"
            :title="panel.title"
            :feed-ids="parseFeedIds(panel.feed_ids_json)"
            :options="parseOptions(panel.options_json)"
          />

          <!-- Panel Controls (visible on hover) -->
          <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 z-20">
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

          <!-- Resize Handles -->
          <div
            class="absolute bottom-0 right-0 w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity cursor-nwse-resize z-20"
            @mousedown="startResize($event, panel, 'se')"
            title="Resize"
          >
            <svg class="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 16 16">
              <path d="M14 14V5.5L5.5 14H14z"/>
            </svg>
          </div>
        </div>

        <!-- Drop preview overlay -->
        <div
          v-if="draggingPanelId && dropPreview"
          :style="getDropPreviewStyle()"
          class="pointer-events-none border-2 border-dashed border-blue-500 bg-blue-500/10 rounded-lg absolute z-10"
        />
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
      class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
      @click.self="showDeleteConfirm = false"
    >
      <div class="bg-gradient-to-br from-gray-800/90 to-gray-900/90 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
            <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 class="text-xl font-bold text-white">Delete Panel</h2>
        </div>
        <p class="text-gray-300 mb-6">
          Are you sure you want to delete "<span class="font-semibold text-white">{{ deletingPanel?.title }}</span>"? This action cannot be undone.
        </p>
        <div class="flex gap-3">
          <button
            @click="handleDeletePanel"
            class="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-4 py-2.5 rounded-lg transition-all transform hover:-translate-y-0.5 shadow-lg hover:shadow-red-500/30"
            :disabled="deleting"
          >
            {{ deleting ? 'Deleting...' : 'Delete' }}
          </button>
          <button
            @click="showDeleteConfirm = false"
            class="btn-secondary-modern flex-1"
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

// Drag and resize state
const draggingPanelId = ref<string | null>(null)
const draggingPanel = ref<Panel | null>(null)
const dragStartX = ref(0)
const dragStartY = ref(0)
const resizingPanelId = ref<string | null>(null)
const resizingPanel = ref<Panel | null>(null)
const resizeStartX = ref(0)
const resizeStartY = ref(0)
const resizeStartWidth = ref(0)
const resizeStartHeight = ref(0)
const dropPreview = ref<{ x: number; y: number; width: number; height: number } | null>(null)

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
  // Use explicit grid positioning based on position_x and position_y
  return {
    gridColumn: `${panel.position_x + 1} / span ${panel.width}`,
    gridRow: `${panel.position_y + 1} / span ${panel.height}`,
  }
}

function getDropPreviewStyle() {
  if (!dropPreview.value) return {}
  return {
    gridColumn: `${dropPreview.value.x + 1} / span ${dropPreview.value.width}`,
    gridRow: `${dropPreview.value.y + 1} / span ${dropPreview.value.height}`,
  }
}

// Drag and drop functions
function startDrag(event: MouseEvent, panel: Panel) {
  event.preventDefault()
  draggingPanelId.value = panel.id
  draggingPanel.value = panel
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY

  // Set initial drop preview to current position
  dropPreview.value = {
    x: panel.position_x,
    y: panel.position_y,
    width: panel.width,
    height: panel.height
  }

  document.addEventListener('mousemove', handleDragMove)
  document.addEventListener('mouseup', handleDragEnd)
}

function handleDragMove(event: MouseEvent) {
  if (!draggingPanel.value) return

  // Calculate grid cell size (approximate based on viewport)
  const gridElement = event.target instanceof Element
    ? event.target.closest('.grid')
    : null
  if (!gridElement) return

  const rect = gridElement.getBoundingClientRect()
  const cellWidth = rect.width / 12 // 12 columns
  const cellHeight = 150 + 16 // 150px + 16px gap

  // Calculate movement in grid cells
  const deltaX = event.clientX - dragStartX.value
  const deltaY = event.clientY - dragStartY.value
  const gridDeltaX = Math.round(deltaX / cellWidth)
  const gridDeltaY = Math.round(deltaY / cellHeight)

  // Calculate new position (constrained to grid)
  let newX = draggingPanel.value.position_x + gridDeltaX
  let newY = draggingPanel.value.position_y + gridDeltaY

  // Constrain to grid bounds
  newX = Math.max(0, Math.min(newX, 12 - draggingPanel.value.width))
  newY = Math.max(0, newY)

  // Update drop preview
  dropPreview.value = {
    x: newX,
    y: newY,
    width: draggingPanel.value.width,
    height: draggingPanel.value.height
  }
}

async function handleDragEnd() {
  if (!draggingPanel.value || !dropPreview.value) {
    cleanup()
    return
  }

  // Check if position actually changed
  if (
    dropPreview.value.x !== draggingPanel.value.position_x ||
    dropPreview.value.y !== draggingPanel.value.position_y
  ) {
    // Update panel position
    try {
      await apiClient.updatePanel(dashboardId.value, draggingPanel.value.id, {
        position_x: dropPreview.value.x,
        position_y: dropPreview.value.y
      })

      // Reload dashboard to reflect changes
      await loadDashboard()
    } catch (e) {
      console.error('Failed to update panel position:', e)
      alert('Failed to move panel: ' + (e instanceof Error ? e.message : 'Unknown error'))
    }
  }

  cleanup()

  function cleanup() {
    draggingPanelId.value = null
    draggingPanel.value = null
    dropPreview.value = null
    document.removeEventListener('mousemove', handleDragMove)
    document.removeEventListener('mouseup', handleDragEnd)
  }
}

// Resize functions
function startResize(event: MouseEvent, panel: Panel, direction: string) {
  event.preventDefault()
  event.stopPropagation()

  resizingPanelId.value = panel.id
  resizingPanel.value = panel
  resizeStartX.value = event.clientX
  resizeStartY.value = event.clientY
  resizeStartWidth.value = panel.width
  resizeStartHeight.value = panel.height

  document.addEventListener('mousemove', handleResizeMove)
  document.addEventListener('mouseup', handleResizeEnd)
}

function handleResizeMove(event: MouseEvent) {
  if (!resizingPanel.value) return

  // Calculate grid cell size
  const gridElement = document.querySelector('.grid')
  if (!gridElement) return

  const rect = gridElement.getBoundingClientRect()
  const cellWidth = rect.width / 12
  const cellHeight = 150 + 16

  // Calculate delta in grid cells
  const deltaX = event.clientX - resizeStartX.value
  const deltaY = event.clientY - resizeStartY.value
  const gridDeltaX = Math.round(deltaX / cellWidth)
  const gridDeltaY = Math.round(deltaY / cellHeight)

  // Calculate new dimensions
  let newWidth = resizeStartWidth.value + gridDeltaX
  let newHeight = resizeStartHeight.value + gridDeltaY

  // Constrain dimensions
  newWidth = Math.max(1, Math.min(newWidth, 12 - resizingPanel.value.position_x))
  newHeight = Math.max(1, Math.min(newHeight, 6))

  // Update panel dimensions optimistically
  resizingPanel.value.width = newWidth
  resizingPanel.value.height = newHeight
}

async function handleResizeEnd() {
  if (!resizingPanel.value) {
    cleanupResize()
    return
  }

  // Check if size actually changed
  if (
    resizingPanel.value.width !== resizeStartWidth.value ||
    resizingPanel.value.height !== resizeStartHeight.value
  ) {
    // Update panel size
    try {
      await apiClient.updatePanel(dashboardId.value, resizingPanel.value.id, {
        width: resizingPanel.value.width,
        height: resizingPanel.value.height
      })

      // Reload dashboard to reflect changes
      await loadDashboard()
    } catch (e) {
      console.error('Failed to update panel size:', e)
      alert('Failed to resize panel: ' + (e instanceof Error ? e.message : 'Unknown error'))
      // Reload to revert optimistic update
      await loadDashboard()
    }
  }

  cleanupResize()

  function cleanupResize() {
    resizingPanelId.value = null
    resizingPanel.value = null
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeEnd)
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
