<template>
  <div class="panel h-full flex flex-col">
    <div class="panel-header">
      <h3 class="panel-title">{{ title }}</h3>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <div class="text-gray-400">Loading...</div>
    </div>

    <div v-else-if="error" class="flex-1 flex items-center justify-center">
      <div class="text-red-400">{{ error }}</div>
    </div>

    <div v-else-if="value !== null" class="flex-1 flex flex-col justify-center">
      <div class="stat-value" :style="{ color: valueColor }">
        {{ formattedValue }}
      </div>
      <div class="stat-label mt-1">{{ label }}</div>
      <div v-if="trend !== null" class="mt-2 text-sm" :class="trendClass">
        <span v-if="trend > 0">↑</span>
        <span v-else-if="trend < 0">↓</span>
        <span v-else>→</span>
        {{ Math.abs(trend).toFixed(1) }}%
      </div>
    </div>

    <div v-else class="flex-1 flex items-center justify-center">
      <div class="text-gray-500">No data</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { useLiveDataStore } from '../../stores/liveData'
import type { PanelOptions } from '../../types'

interface Props {
  title: string
  feedIds: string[]
  options?: PanelOptions
}

const props = withDefaults(defineProps<Props>(), {
  options: () => ({}),
})

const liveDataStore = useLiveDataStore()

const loading = ref(false)
const error = ref<string | null>(null)
const value = ref<number | null>(null)
const previousValue = ref<number | null>(null)

const fieldName = computed(() => props.options.field || 'value')
const label = computed(() => props.title)

// Extract value from latest feed data
watch(
  () => liveDataStore.latest,
  () => {
    if (props.feedIds.length === 0) return

    const feedId = props.feedIds[0]
    if (!feedId) return

    const feedData = liveDataStore.latest[feedId]

    if (feedData && feedData.payload) {
      const newValue = feedData.payload[fieldName.value]

      if (typeof newValue === 'number') {
        previousValue.value = value.value
        value.value = newValue
        error.value = null
      }
    }
  },
  { deep: true, immediate: true }
)

// Format value with prefix/suffix
const formattedValue = computed(() => {
  if (value.value === null) return '-'

  const decimals = props.options.decimals ?? 0
  const formatted = value.value.toFixed(decimals)

  return `${props.options.prefix || ''}${formatted}${props.options.suffix || props.options.unit || ''}`
})

// Calculate trend percentage
const trend = computed(() => {
  if (value.value === null || previousValue.value === null) return null
  if (previousValue.value === 0) return null

  return ((value.value - previousValue.value) / previousValue.value) * 100
})

// Trend styling
const trendClass = computed(() => {
  if (trend.value === null) return ''
  if (trend.value > 0) return 'text-green-400'
  if (trend.value < 0) return 'text-red-400'
  return 'text-gray-400'
})

// Value color based on thresholds
const valueColor = computed(() => {
  if (value.value === null || !props.options.thresholds) return '#60a5fa'

  const thresholds = props.options.thresholds.sort((a, b) => b.value - a.value)

  for (const threshold of thresholds) {
    if (value.value >= threshold.value) {
      return threshold.color
    }
  }

  return '#60a5fa'
})
</script>
