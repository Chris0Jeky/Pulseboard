<template>
  <div class="min-h-screen bg-gray-900">
    <!-- Header -->
    <div class="bg-gray-800 border-b border-gray-700">
      <div class="max-w-full px-4 sm:px-6 lg:px-8 py-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <router-link
              :to="{ name: 'dashboards' }"
              class="text-gray-400 hover:text-white transition-colors"
            >
              ← Back
            </router-link>
            <h1 class="text-2xl font-bold text-white">
              {{ dashboard?.name || 'Loading...' }}
            </h1>
          </div>

          <div class="flex items-center gap-4">
            <!-- WebSocket status indicator -->
            <div class="flex items-center gap-2">
              <div
                class="w-2 h-2 rounded-full"
                :class="{
                  'bg-green-500': wsStatus === 'connected',
                  'bg-yellow-500': wsStatus === 'connecting',
                  'bg-red-500': wsStatus === 'disconnected' || wsStatus === 'error',
                }"
              />
              <span class="text-sm text-gray-400">
                {{ wsStatusText }}
              </span>
            </div>
          </div>
        </div>

        <p v-if="dashboard?.description" class="text-gray-400 mt-2">
          {{ dashboard.description }}
        </p>
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
        <div class="text-gray-400">This dashboard has no panels yet</div>
      </div>

      <!-- Panel grid -->
      <div v-else class="grid grid-cols-12 gap-4 auto-rows-[150px]">
        <div
          v-for="panel in dashboard.panels"
          :key="panel.id"
          :style="getPanelStyle(panel)"
          class="min-h-0"
        >
          <component
            :is="getPanelComponent(panel.type)"
            :title="panel.title"
            :feed-ids="parseFeedIds(panel.feed_ids_json)"
            :options="parseOptions(panel.options_json)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useDashboardsStore } from '../stores/dashboards'
import { useUiStore } from '../stores/ui'
import { useDashboardWebSocket } from '../composables/useDashboardWebSocket'
import PanelStat from '../components/panels/PanelStat.vue'
import PanelTimeseries from '../components/panels/PanelTimeseries.vue'
import PanelBar from '../components/panels/PanelBar.vue'
import type { Panel, PanelOptions } from '../types'

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

async function loadDashboard() {
  await dashboardsStore.fetchDashboard(dashboardId.value)
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
  await loadDashboard()

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
