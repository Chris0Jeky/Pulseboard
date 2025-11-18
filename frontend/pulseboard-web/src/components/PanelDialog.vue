<template>
  <div
    v-if="show"
    class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
    @click.self="$emit('close')"
  >
    <div class="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
      <h2 class="text-xl font-bold text-white mb-4">
        {{ editMode ? 'Edit Panel' : 'Create Panel' }}
      </h2>

      <form @submit.prevent="handleSubmit">
        <!-- Panel Type -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Panel Type *
          </label>
          <select
            v-model="formData.type"
            required
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="stat">Stat (Single Value)</option>
            <option value="timeseries">Timeseries (Line Chart)</option>
            <option value="bar">Bar Chart</option>
            <option value="table">Table</option>
          </select>
        </div>

        <!-- Title -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Title *
          </label>
          <input
            v-model="formData.title"
            type="text"
            required
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder="CPU Usage"
          />
        </div>

        <!-- Feed Selection -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Feeds *
          </label>
          <div class="space-y-2">
            <div v-for="feed in availableFeeds" :key="feed.id" class="flex items-center">
              <input
                :id="`feed-${feed.id}`"
                v-model="selectedFeedIds"
                type="checkbox"
                :value="feed.id"
                class="w-4 h-4 text-primary-600 bg-gray-700 border-gray-600 rounded focus:ring-primary-500"
              />
              <label
                :for="`feed-${feed.id}`"
                class="ml-2 text-sm text-gray-300"
              >
                {{ feed.name }} ({{ feed.type }})
              </label>
            </div>
          </div>
          <p class="text-xs text-gray-500 mt-1">
            Select one or more feeds to display in this panel
          </p>
        </div>

        <!-- Options (Panel-specific configuration) -->
        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-300 mb-2">
            Panel Options (JSON)
          </label>
          <textarea
            v-model="formData.options_json"
            rows="6"
            class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            :class="{ 'border-red-500': optionsError }"
            placeholder='{"field": "value", "color": "#60a5fa"}'
          />
          <p v-if="optionsError" class="text-xs text-red-400 mt-1">
            {{ optionsError }}
          </p>
          <p v-else class="text-xs text-gray-500 mt-1">
            {{ getOptionsHelp() }}
          </p>
        </div>

        <!-- Position and Size -->
        <div class="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Width (grid columns) *
            </label>
            <input
              v-model.number="formData.width"
              type="number"
              min="1"
              max="12"
              required
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Height (grid rows) *
            </label>
            <input
              v-model.number="formData.height"
              type="number"
              min="1"
              max="6"
              required
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <!-- Position (optional for new panels, required for edit) -->
        <div v-if="editMode" class="mb-4 grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Position X *
            </label>
            <input
              v-model.number="formData.position_x"
              type="number"
              min="0"
              required
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Position Y *
            </label>
            <input
              v-model.number="formData.position_y"
              type="number"
              min="0"
              required
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="flex gap-3 mt-6">
          <button type="submit" class="btn-primary flex-1" :disabled="submitting">
            {{ submitting ? 'Saving...' : (editMode ? 'Update' : 'Create') }}
          </button>
          <button
            type="button"
            @click="$emit('close')"
            class="btn-secondary flex-1"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { Panel, FeedDefinition, PanelCreate } from '../types'

interface Props {
  show: boolean
  panel?: Panel | null
  availableFeeds: FeedDefinition[]
}

const props = withDefaults(defineProps<Props>(), {
  panel: null,
})

const emit = defineEmits<{
  close: []
  submit: [data: PanelCreate]
}>()

const editMode = computed(() => !!props.panel)
const submitting = ref(false)
const optionsError = ref<string | null>(null)

const formData = ref<{
  type: string
  title: string
  options_json: string
  width: number
  height: number
  position_x: number
  position_y: number
}>({
  type: 'stat',
  title: '',
  options_json: '{}',
  width: 4,
  height: 2,
  position_x: 0,
  position_y: 0,
})

const selectedFeedIds = ref<string[]>([])

// Initialize form data when panel prop changes
watch(
  () => props.panel,
  (panel) => {
    if (panel) {
      formData.value = {
        type: panel.type,
        title: panel.title,
        options_json: panel.options_json || '{}',
        width: panel.width,
        height: panel.height,
        position_x: panel.position_x,
        position_y: panel.position_y,
      }
      // Parse feed IDs
      try {
        selectedFeedIds.value = JSON.parse(panel.feed_ids_json)
      } catch {
        selectedFeedIds.value = []
      }
    } else {
      // Reset for new panel
      formData.value = {
        type: 'stat',
        title: '',
        options_json: '{}',
        width: 4,
        height: 2,
        position_x: 0,
        position_y: 0,
      }
      selectedFeedIds.value = []
    }
  },
  { immediate: true }
)

function validateOptions(): boolean {
  if (!formData.value.options_json.trim()) {
    formData.value.options_json = '{}'
    return true
  }

  try {
    JSON.parse(formData.value.options_json)
    optionsError.value = null
    return true
  } catch (e) {
    optionsError.value = e instanceof Error ? e.message : 'Invalid JSON'
    return false
  }
}

function getOptionsHelp(): string {
  const helps: Record<string, string> = {
    stat: 'Options: field, color, unit, prefix, suffix, decimals, thresholds',
    timeseries: 'Options: field, color, max, min',
    bar: 'Options: color, colors',
    table: 'Options: fields, colors',
  }
  return helps[formData.value.type] || 'Panel-specific configuration'
}

async function handleSubmit() {
  if (!validateOptions()) return
  if (selectedFeedIds.value.length === 0) {
    optionsError.value = 'Please select at least one feed'
    return
  }

  submitting.value = true
  optionsError.value = null

  try {
    const data: PanelCreate = {
      type: formData.value.type,
      title: formData.value.title,
      feed_ids_json: JSON.stringify(selectedFeedIds.value),
      options_json: formData.value.options_json || '{}',
      width: formData.value.width,
      height: formData.value.height,
    }

    // Only include position for edit mode
    if (editMode.value) {
      data.position_x = formData.value.position_x
      data.position_y = formData.value.position_y
    }

    emit('submit', data)
  } catch (e) {
    console.error('Failed to submit panel:', e)
    optionsError.value = e instanceof Error ? e.message : 'Failed to submit'
  } finally {
    submitting.value = false
  }
}
</script>
