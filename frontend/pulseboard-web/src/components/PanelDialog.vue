<template>
  <div
    v-if="show"
    class="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
    @click.self="$emit('close')"
  >
    <div class="bg-gradient-to-br from-gray-800/95 to-gray-900/95 border border-white/10 rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-2xl flex flex-col">
      <!-- Header -->
      <div class="px-6 py-5 border-b border-white/10">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-gradient-to-br from-blue-500/20 to-purple-600/20 rounded-lg flex items-center justify-center border border-blue-500/30">
            <svg class="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <div>
            <h2 class="text-2xl font-bold text-white">
              {{ editMode ? 'Edit Panel' : 'Create New Panel' }}
            </h2>
            <p class="text-sm text-gray-400">Configure your dashboard panel</p>
          </div>
        </div>
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-y-auto px-6 py-6">
        <form @submit.prevent="handleSubmit" class="space-y-6">

          <!-- Panel Type Selection -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              Panel Type *
            </label>
            <div class="grid grid-cols-3 gap-3">
              <button
                v-for="type in panelTypes"
                :key="type.value"
                type="button"
                @click="formData.type = type.value"
                class="panel-type-card"
                :class="{ 'selected': formData.type === type.value }"
              >
                <div class="flex flex-col items-center gap-2 p-4">
                  <div class="w-12 h-12 rounded-lg flex items-center justify-center" :class="type.iconBg">
                    <component :is="type.icon" class="w-6 h-6" :class="type.iconColor" />
                  </div>
                  <div class="text-center">
                    <div class="font-semibold text-white text-sm">{{ type.label }}</div>
                    <div class="text-xs text-gray-400">{{ type.description }}</div>
                  </div>
                </div>
              </button>
            </div>
          </div>

          <!-- Title -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              Panel Title *
            </label>
            <input
              v-model="formData.title"
              type="text"
              required
              class="w-full px-4 py-2.5 rounded-lg text-white placeholder-gray-500"
              placeholder="e.g., CPU Usage, Bitcoin Price"
            />
          </div>

          <!-- Feed Selection -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              Data Sources * <span class="text-xs text-gray-500">(Select one or more feeds)</span>
            </label>
            <div class="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-2">
              <label
                v-for="feed in availableFeeds"
                :key="feed.id"
                class="feed-card"
                :class="{ 'selected': selectedFeedIds.includes(feed.id) }"
              >
                <input
                  type="checkbox"
                  :value="feed.id"
                  v-model="selectedFeedIds"
                  class="sr-only"
                />
                <div class="flex items-center gap-3 p-3">
                  <div class="flex-shrink-0">
                    <div class="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center border border-purple-500/30">
                      <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-medium text-white text-sm">{{ feed.name }}</div>
                    <div class="text-xs text-gray-400">{{ feed.type }}</div>
                  </div>
                  <div class="check-icon">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              </label>
            </div>
          </div>

          <!-- Configuration Options -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              Configuration
            </label>

            <!-- Common options based on panel type -->
            <div class="space-y-3">
              <!-- Field name (for stat/timeseries) -->
              <div v-if="['stat', 'timeseries'].includes(formData.type)">
                <label class="block text-xs font-medium text-gray-400 mb-1.5">
                  Data Field
                </label>
                <input
                  v-model="config.field"
                  type="text"
                  class="w-full px-3 py-2 rounded-lg text-white text-sm placeholder-gray-500"
                  placeholder="e.g., cpu_percent, price, value"
                />
                <p class="text-xs text-gray-500 mt-1">The field name to extract from feed data</p>
              </div>

              <!-- Color -->
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">
                    Color
                  </label>
                  <input
                    v-model="config.color"
                    type="color"
                    class="w-full h-10 rounded-lg cursor-pointer"
                  />
                </div>

                <!-- Unit/Suffix (for stat) -->
                <div v-if="formData.type === 'stat'">
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">
                    Unit/Suffix
                  </label>
                  <input
                    v-model="config.unit"
                    type="text"
                    class="w-full px-3 py-2 rounded-lg text-white text-sm placeholder-gray-500"
                    placeholder="%, $, MB"
                  />
                </div>

                <!-- Decimals (for stat) -->
                <div v-if="formData.type === 'stat'">
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">
                    Decimal Places
                  </label>
                  <input
                    v-model.number="config.decimals"
                    type="number"
                    min="0"
                    max="4"
                    class="w-full px-3 py-2 rounded-lg text-white text-sm"
                  />
                </div>
              </div>

              <!-- Min/Max (for timeseries) -->
              <div v-if="formData.type === 'timeseries'" class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">
                    Min Value
                  </label>
                  <input
                    v-model.number="config.min"
                    type="number"
                    class="w-full px-3 py-2 rounded-lg text-white text-sm"
                    placeholder="Auto"
                  />
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-400 mb-1.5">
                    Max Value
                  </label>
                  <input
                    v-model.number="config.max"
                    type="number"
                    class="w-full px-3 py-2 rounded-lg text-white text-sm"
                    placeholder="Auto"
                  />
                </div>
              </div>

              <!-- Advanced JSON editor toggle -->
              <details class="group">
                <summary class="cursor-pointer text-xs text-blue-400 hover:text-blue-300 select-none">
                  Advanced JSON Editor
                </summary>
                <div class="mt-2">
                  <textarea
                    v-model="formData.options_json"
                    rows="4"
                    class="w-full px-3 py-2 rounded-lg text-white font-mono text-xs"
                    :class="{ 'border-red-500 border-2': optionsError }"
                  />
                  <p v-if="optionsError" class="text-xs text-red-400 mt-1">
                    {{ optionsError }}
                  </p>
                </div>
              </details>
            </div>
          </div>

          <!-- Size -->
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-3">
              Panel Size
            </label>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1.5">
                  Width <span class="text-gray-500">(1-12 columns)</span>
                </label>
                <input
                  v-model.number="formData.width"
                  type="range"
                  min="1"
                  max="12"
                  class="w-full"
                />
                <div class="text-center text-white font-semibold mt-1">{{ formData.width }}</div>
              </div>
              <div>
                <label class="block text-xs font-medium text-gray-400 mb-1.5">
                  Height <span class="text-gray-500">(1-6 rows)</span>
                </label>
                <input
                  v-model.number="formData.height"
                  type="range"
                  min="1"
                  max="6"
                  class="w-full"
                />
                <div class="text-center text-white font-semibold mt-1">{{ formData.height }}</div>
              </div>
            </div>
          </div>

        </form>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-white/10 bg-black/20">
        <div class="flex gap-3">
          <button
            type="button"
            @click="handleSubmit"
            class="btn-primary-modern flex-1"
            :disabled="submitting || selectedFeedIds.length === 0"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
            </svg>
            {{ submitting ? 'Saving...' : (editMode ? 'Update Panel' : 'Create Panel') }}
          </button>
          <button
            type="button"
            @click="$emit('close')"
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
import { ref, watch, computed, h } from 'vue'
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

// Panel type definitions with icons
const panelTypes = [
  {
    value: 'stat',
    label: 'Stat',
    description: 'Single value',
    icon: () => h('svg', { class: 'w-6 h-6', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' })
    ]),
    iconBg: 'bg-green-500/10 border border-green-500/30',
    iconColor: 'text-green-400'
  },
  {
    value: 'timeseries',
    label: 'Line Chart',
    description: 'Time series',
    icon: () => h('svg', { class: 'w-6 h-6', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' })
    ]),
    iconBg: 'bg-blue-500/10 border border-blue-500/30',
    iconColor: 'text-blue-400'
  },
  {
    value: 'bar',
    label: 'Bar Chart',
    description: 'Comparisons',
    icon: () => h('svg', { class: 'w-6 h-6', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' }, [
      h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' })
    ]),
    iconBg: 'bg-purple-500/10 border border-purple-500/30',
    iconColor: 'text-purple-400'
  }
]

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

// Simplified config object
const config = ref<{
  field: string
  color: string
  unit: string
  decimals: number
  min: number | null
  max: number | null
}>({
  field: 'value',
  color: '#60a5fa',
  unit: '',
  decimals: 0,
  min: null,
  max: null
})

// Watch config and update options_json
watch(config, (newConfig) => {
  const options: Record<string, any> = {}
  if (newConfig.field) options.field = newConfig.field
  if (newConfig.color && newConfig.color !== '#60a5fa') options.color = newConfig.color
  if (newConfig.unit) options.unit = newConfig.unit
  if (newConfig.decimals > 0) options.decimals = newConfig.decimals
  if (newConfig.min !== null) options.min = newConfig.min
  if (newConfig.max !== null) options.max = newConfig.max

  formData.value.options_json = JSON.stringify(options, null, 2)
}, { deep: true })

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

      // Parse options into config
      try {
        const opts = JSON.parse(panel.options_json || '{}')
        config.value = {
          field: opts.field || 'value',
          color: opts.color || '#60a5fa',
          unit: opts.unit || '',
          decimals: opts.decimals || 0,
          min: opts.min ?? null,
          max: opts.max ?? null
        }
      } catch {
        // Keep defaults
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
      config.value = {
        field: 'value',
        color: '#60a5fa',
        unit: '',
        decimals: 0,
        min: null,
        max: null
      }
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

<style scoped>
.panel-type-card {
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%);
  border: 2px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.75rem;
  transition: all 0.2s ease;
  cursor: pointer;
}

.panel-type-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
  transform: translateY(-2px);
}

.panel-type-card.selected {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(147, 51, 234, 0.15) 100%);
  border-color: rgba(59, 130, 246, 0.5);
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
}

.feed-card {
  background: linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%);
  border: 2px solid rgba(148, 163, 184, 0.1);
  border-radius: 0.5rem;
  transition: all 0.2s ease;
  cursor: pointer;
  position: relative;
}

.feed-card:hover {
  border-color: rgba(59, 130, 246, 0.3);
}

.feed-card.selected {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(147, 51, 234, 0.1) 100%);
  border-color: rgba(59, 130, 246, 0.5);
}

.check-icon {
  opacity: 0;
  color: rgb(96, 165, 250);
  transition: opacity 0.2s ease;
}

.feed-card.selected .check-icon {
  opacity: 1;
}

input[type="range"] {
  @apply accent-blue-500;
}

input[type="color"] {
  border: 2px solid rgba(148, 163, 184, 0.2);
  background-color: rgba(30, 41, 59, 0.6);
}

input[type="color"]::-webkit-color-swatch-wrapper {
  padding: 2px;
}

input[type="color"]::-webkit-color-swatch {
  border: none;
  border-radius: 0.375rem;
}
</style>
