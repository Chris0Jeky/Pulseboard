<template>
  <div class="min-h-screen bg-gray-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="flex items-center justify-between mb-8">
        <h1 class="text-3xl font-bold text-white">Dashboards</h1>
        <div class="flex gap-3">
          <router-link
            :to="{ name: 'feeds' }"
            class="btn-secondary"
          >
            Manage Feeds
          </router-link>
          <button @click="showCreateDialog = true" class="btn-primary">
            + Create Dashboard
          </button>
        </div>
      </div>

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
        <router-link
          v-for="dashboard in dashboards"
          :key="dashboard.id"
          :to="{ name: 'dashboard-live', params: { id: dashboard.id } }"
          class="panel hover:border-primary-500 transition-colors cursor-pointer group"
        >
          <h2 class="text-xl font-semibold text-white group-hover:text-primary-400 transition-colors">
            {{ dashboard.name }}
          </h2>
          <p v-if="dashboard.description" class="text-gray-400 mt-2">
            {{ dashboard.description }}
          </p>
          <div class="mt-4 flex items-center justify-between text-sm text-gray-500">
            <span>{{ dashboard.panels?.length || 0 }} panels</span>
            <span>{{ formatDate(dashboard.updated_at) }}</span>
          </div>
        </router-link>
      </div>

      <!-- Create dialog -->
      <div
        v-if="showCreateDialog"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        @click.self="showCreateDialog = false"
      >
        <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
          <h2 class="text-xl font-bold text-white mb-4">Create Dashboard</h2>

          <form @submit.prevent="handleCreate">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-300 mb-2">
                Name *
              </label>
              <input
                v-model="newDashboard.name"
                type="text"
                required
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
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
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder="Optional description..."
              />
            </div>

            <div class="flex gap-3">
              <button type="submit" class="btn-primary flex-1" :disabled="creating">
                {{ creating ? 'Creating...' : 'Create' }}
              </button>
              <button
                type="button"
                @click="showCreateDialog = false"
                class="btn-secondary flex-1"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDashboardsStore } from '../stores/dashboards'

const router = useRouter()
const dashboardsStore = useDashboardsStore()

const dashboards = computed(() => dashboardsStore.dashboards)
const loading = computed(() => dashboardsStore.loading)
const error = computed(() => dashboardsStore.error)

const showCreateDialog = ref(false)
const creating = ref(false)
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
