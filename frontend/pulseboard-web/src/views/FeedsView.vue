<template>
  <div class="min-h-screen bg-gray-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="flex items-center justify-between mb-8">
        <div class="flex items-center gap-4">
          <router-link
            :to="{ name: 'dashboards' }"
            class="text-gray-400 hover:text-white transition-colors"
          >
            ← Back
          </router-link>
          <div>
            <h1 class="text-3xl font-bold text-white">Feeds</h1>
            <p class="text-gray-400 mt-1">Manage data sources for your dashboards</p>
          </div>
        </div>
        <button @click="showCreateDialog = true" class="btn-primary">
          + Create Feed
        </button>
      </div>

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
          class="panel flex items-center justify-between"
        >
          <div class="flex-1">
            <div class="flex items-center gap-3">
              <h3 class="text-lg font-semibold text-white">{{ feed.name }}</h3>
              <span
                class="px-2 py-1 text-xs rounded"
                :class="
                  feed.enabled
                    ? 'bg-green-900 text-green-300'
                    : 'bg-gray-700 text-gray-400'
                "
              >
                {{ feed.enabled ? 'Enabled' : 'Disabled' }}
              </span>
              <span class="px-2 py-1 text-xs rounded bg-blue-900 text-blue-300">
                {{ feed.type }}
              </span>
            </div>
            <div class="mt-2 text-sm text-gray-400">
              <pre class="inline">{{ formatConfig(feed.config_json) }}</pre>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <button
              @click="toggleFeed(feed)"
              class="btn-secondary text-sm"
              :disabled="toggling === feed.id"
            >
              {{ toggling === feed.id ? 'Updating...' : feed.enabled ? 'Disable' : 'Enable' }}
            </button>
            <button
              @click="openEditDialog(feed)"
              class="btn-secondary text-sm"
            >
              Edit
            </button>
            <button
              @click="confirmDelete(feed)"
              class="bg-red-600 hover:bg-red-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              :disabled="deleting === feed.id"
            >
              {{ deleting === feed.id ? 'Deleting...' : 'Delete' }}
            </button>
          </div>
        </div>

        <div v-if="feeds.length === 0" class="text-center py-12">
          <div class="text-gray-400 mb-4">No feeds configured yet</div>
          <button @click="showCreateDialog = true" class="btn-primary">
            Create your first feed
          </button>
        </div>
      </div>

      <!-- Create/Edit Dialog -->
      <div
        v-if="showCreateDialog || editingFeed"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto"
        @click.self="closeDialog"
      >
        <div class="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 my-8">
          <h2 class="text-xl font-bold text-white mb-4">
            {{ editingFeed ? 'Edit Feed' : 'Create Feed' }}
          </h2>

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
                class="btn-primary flex-1"
                :disabled="submitting"
              >
                {{ submitting ? 'Saving...' : editingFeed ? 'Update' : 'Create' }}
              </button>
              <button
                type="button"
                @click="closeDialog"
                class="btn-secondary flex-1"
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
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
        @click.self="feedToDelete = null"
      >
        <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
          <h2 class="text-xl font-bold text-white mb-4">Confirm Delete</h2>
          <p class="text-gray-300 mb-6">
            Are you sure you want to delete the feed "<strong>{{ feedToDelete.name }}</strong>"?
            This action cannot be undone.
          </p>
          <div class="flex gap-3">
            <button
              @click="deleteFeed"
              class="bg-red-600 hover:bg-red-700 text-white font-medium px-4 py-2 rounded-lg transition-colors flex-1"
            >
              Delete
            </button>
            <button
              @click="feedToDelete = null"
              class="btn-secondary flex-1"
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
