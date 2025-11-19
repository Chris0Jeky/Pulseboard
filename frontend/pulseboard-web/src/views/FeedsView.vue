<template>
  <div class="min-h-screen">
    <!-- Header -->
    <div class="header-gradient border-b border-white/10 backdrop-blur-sm">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
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
              <div class="flex items-center gap-3 mb-1">
                <div class="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                  <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                </div>
                <h1 class="text-4xl font-bold text-white tracking-tight">Feeds</h1>
              </div>
              <p class="text-gray-400 ml-13">Manage data sources for your dashboards</p>
            </div>
          </div>
          <button @click="showCreateDialog = true" class="btn-primary-modern">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Create Feed
          </button>
        </div>
      </div>
    </div>

    <!-- Main Content -->
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      <!-- Loading state -->
      <div v-if="loading" class="text-center py-12">
        <div class="text-gray-400">Loading feeds...</div>
      </div>

      <!-- Error state -->
      <div v-else-if="error" class="text-center py-12">
        <div class="text-red-400">{{ error }}</div>
        <button @click="loadData" class="btn-secondary mt-4">
          Retry
        </button>
      </div>

      <!-- Feeds list -->
      <div v-else class="space-y-4">
        <div
          v-for="feed in feeds"
          :key="feed.id"
          class="dashboard-card group"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 bg-gradient-to-br from-purple-500/20 to-pink-600/20 rounded-lg flex items-center justify-center border border-purple-500/30">
                  <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="text-lg font-semibold text-white group-hover:text-blue-400 transition-colors truncate">{{ feed.name }}</h3>
                  <div class="flex items-center gap-2 mt-1">
                    <span
                      class="px-2.5 py-0.5 text-xs font-medium rounded-full"
                      :class="
                        feed.enabled
                          ? 'bg-green-500/10 text-green-400 border border-green-500/30'
                          : 'bg-gray-500/10 text-gray-400 border border-gray-500/30'
                      "
                    >
                      {{ feed.enabled ? 'Enabled' : 'Disabled' }}
                    </span>
                    <span class="px-2.5 py-0.5 text-xs font-medium rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      {{ feed.type }}
                    </span>
                  </div>
                </div>
              </div>
              <div class="mt-3 text-sm text-gray-400 bg-black/20 rounded-lg p-3 border border-white/5">
                <pre class="text-xs font-mono overflow-x-auto">{{ formatConfig(feed.config_json) }}</pre>
              </div>
            </div>

            <div class="flex flex-col gap-2 shrink-0">
              <button
                @click="toggleFeed(feed)"
                class="btn-secondary-modern text-sm"
                :disabled="toggling === feed.id"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="feed.enabled ? 'M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z' : 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z'" />
                </svg>
                {{ toggling === feed.id ? 'Updating...' : feed.enabled ? 'Disable' : 'Enable' }}
              </button>
              <button
                @click="openEditDialog(feed)"
                class="btn-secondary-modern text-sm"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                Edit
              </button>
              <button
                @click="confirmDelete(feed)"
                class="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-all transform hover:-translate-y-0.5 shadow-lg hover:shadow-red-500/30 inline-flex items-center justify-center gap-2"
                :disabled="deleting === feed.id"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {{ deleting === feed.id ? 'Deleting...' : 'Delete' }}
              </button>
            </div>
          </div>
        </div>

        <div v-if="feeds.length === 0" class="text-center py-20">
          <div class="max-w-md mx-auto">
            <div class="w-16 h-16 bg-gradient-to-br from-purple-500/20 to-pink-600/20 rounded-2xl flex items-center justify-center border border-purple-500/30 mx-auto mb-4">
              <svg class="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
              </svg>
            </div>
            <h3 class="text-xl font-semibold text-white mb-2">No feeds yet</h3>
            <p class="text-gray-400 mb-6">Create your first data source to get started</p>
            <button @click="showCreateDialog = true" class="btn-primary-modern">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
              </svg>
              Create your first feed
            </button>
          </div>
        </div>
      </div>

      <!-- Create/Edit Dialog -->
      <div
        v-if="showCreateDialog || editingFeed"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 overflow-y-auto"
        @click.self="closeDialog"
      >
        <div class="bg-gradient-to-br from-gray-800/95 to-gray-900/95 border border-white/10 rounded-xl p-6 max-w-2xl w-full mx-4 my-8 shadow-2xl">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-pink-600/20 rounded-lg flex items-center justify-center border border-purple-500/30">
              <svg class="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="editingFeed ? 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z' : 'M12 4v16m8-8H4'" />
              </svg>
            </div>
            <h2 class="text-2xl font-bold text-white">
              {{ editingFeed ? 'Edit Feed' : 'Create Feed' }}
            </h2>
          </div>

          <form @submit.prevent="handleSubmit">
            <div class="space-y-4">
              <!-- Name -->
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  Name *
                </label>
                <input
                  v-model="feedForm.name"
                  type="text"
                  required
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder="My Feed"
                />
              </div>

              <!-- Type -->
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  Type *
                </label>
                <select
                  v-model="feedForm.type"
                  required
                  :disabled="!!editingFeed || feedTypes.length === 0"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
                  @change="updateConfigTemplate"
                >
                  <option value="" disabled>Select type...</option>
                  <option v-for="type in feedTypes" :key="type.type" :value="type.type">
                    {{ type.name }}
                  </option>
                </select>
              </div>

              <!-- Config JSON -->
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  Configuration (JSON) *
                </label>
                <textarea
                  v-model="feedForm.config_json"
                  rows="8"
                  required
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                  placeholder='{"interval_sec": 5}'
                />
                <p v-if="configError" class="text-red-400 text-sm mt-1">
                  {{ configError }}
                </p>
                <p v-else class="text-gray-500 text-sm mt-1">
                  {{ getConfigHelp(feedForm.type) }}
                </p>
              </div>

              <!-- Enabled -->
              <div class="flex items-center">
                <input
                  v-model="feedForm.enabled"
                  type="checkbox"
                  id="feed-enabled"
                  class="w-4 h-4 text-primary-600 bg-gray-700 border-gray-600 rounded focus:ring-primary-500"
                />
                <label for="feed-enabled" class="ml-2 text-sm text-gray-300">
                  Enable feed immediately
                </label>
              </div>
            </div>

            <div class="flex gap-3 mt-6">
              <button
                type="submit"
                class="btn-primary-modern flex-1"
                :disabled="submitting"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                {{ submitting ? 'Saving...' : editingFeed ? 'Update' : 'Create' }}
              </button>
              <button
                type="button"
                @click="closeDialog"
                class="btn-secondary-modern flex-1"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- Delete Confirmation -->
      <div
        v-if="feedToDelete"
        class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50"
        @click.self="feedToDelete = null"
      >
        <div class="bg-gradient-to-br from-gray-800/90 to-gray-900/90 border border-white/10 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 bg-red-500/10 rounded-lg flex items-center justify-center border border-red-500/20">
              <svg class="w-6 h-6 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 class="text-xl font-bold text-white">Confirm Delete</h2>
          </div>
          <p class="text-gray-300 mb-6">
            Are you sure you want to delete the feed "<span class="font-semibold text-white">{{ feedToDelete.name }}</span>"?
            This action cannot be undone.
          </p>
          <div class="flex gap-3">
            <button
              @click="deleteFeed"
              class="flex-1 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-4 py-2.5 rounded-lg transition-all transform hover:-translate-y-0.5 shadow-lg hover:shadow-red-500/30"
            >
              Delete
            </button>
            <button
              @click="feedToDelete = null"
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
import { computed, onMounted, ref } from 'vue'
import apiClient from '../api/client'
import type { FeedDefinition, FeedType } from '../types'

const feeds = ref<FeedDefinition[]>([])
const feedTypes = ref<FeedType[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const showCreateDialog = ref(false)
const editingFeed = ref<FeedDefinition | null>(null)
const feedToDelete = ref<FeedDefinition | null>(null)
const submitting = ref(false)
const deleting = ref<string | null>(null)
const toggling = ref<string | null>(null)
const configError = ref<string | null>(null)

const feedForm = ref({
  name: '',
  type: '',
  config_json: '{}',
  enabled: true,
})

const selectedFeedType = computed(() =>
  feedTypes.value.find((type) => type.type === feedForm.value.type)
)

function getConfigHelp(type: string): string {
  const metadata = feedTypes.value.find((feedType) => feedType.type === type)
  return metadata?.description || 'Enter valid JSON configuration'
}

function updateConfigTemplate() {
  if (feedForm.value.type && !editingFeed.value) {
    const template = selectedFeedType.value?.default_config || {}
    feedForm.value.config_json = JSON.stringify(template, null, 2)
  }
}

function formatConfig(json: string): string {
  try {
    const config = JSON.parse(json)
    return JSON.stringify(config, null, 2)
  } catch {
    return json
  }
}

function validateConfig(): boolean {
  configError.value = null
  try {
    JSON.parse(feedForm.value.config_json)
    return true
  } catch (e) {
    configError.value = e instanceof Error ? e.message : 'Invalid JSON'
    return false
  }
}

async function loadData() {
  loading.value = true
  error.value = null

  try {
    const [types, feedList] = await Promise.all([
      apiClient.getFeedTypes(),
      apiClient.getFeeds(),
    ])
    feedTypes.value = types
    feeds.value = feedList
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to load feeds'
  } finally {
    loading.value = false
  }
}

async function handleSubmit() {
  if (!validateConfig()) return

  submitting.value = true
  try {
    if (editingFeed.value) {
      // Update existing feed
      const updated = await apiClient.updateFeed(editingFeed.value.id, {
        name: feedForm.value.name,
        config_json: feedForm.value.config_json,
        enabled: feedForm.value.enabled,
      })

      const index = feeds.value.findIndex((f) => f.id === updated.id)
      if (index !== -1) {
        feeds.value[index] = updated
      }
    } else {
      // Create new feed
      const newFeed = await apiClient.createFeed({
        type: feedForm.value.type,
        name: feedForm.value.name,
        config_json: feedForm.value.config_json,
        enabled: feedForm.value.enabled,
      })

      feeds.value.push(newFeed)
    }

    closeDialog()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Operation failed'
  } finally {
    submitting.value = false
  }
}

async function toggleFeed(feed: FeedDefinition) {
  toggling.value = feed.id

  try {
    const updated = await apiClient.updateFeed(feed.id, {
      enabled: !feed.enabled,
    })

    const index = feeds.value.findIndex((f) => f.id === feed.id)
    if (index !== -1) {
      feeds.value[index] = updated
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to toggle feed'
  } finally {
    toggling.value = null
  }
}

function openEditDialog(feed: FeedDefinition) {
  editingFeed.value = feed
  feedForm.value = {
    name: feed.name,
    type: feed.type,
    config_json: formatConfig(feed.config_json),
    enabled: feed.enabled,
  }
}

function confirmDelete(feed: FeedDefinition) {
  feedToDelete.value = feed
}

async function deleteFeed() {
  if (!feedToDelete.value) return

  deleting.value = feedToDelete.value.id

  try {
    await apiClient.deleteFeed(feedToDelete.value.id)
    feeds.value = feeds.value.filter((f) => f.id !== feedToDelete.value!.id)
    feedToDelete.value = null
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to delete feed'
  } finally {
    deleting.value = null
  }
}

function closeDialog() {
  showCreateDialog.value = false
  editingFeed.value = null
  feedForm.value = {
    name: '',
    type: '',
    config_json: '{}',
    enabled: true,
  }
  configError.value = null
}

onMounted(() => {
  loadData()
})
</script>
