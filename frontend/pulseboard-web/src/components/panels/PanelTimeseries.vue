<template>
  <div class="panel h-full flex flex-col">
    <div class="panel-header">
      <h3 class="panel-title">{{ title }}</h3>
    </div>

    <div class="flex-1 min-h-0">
      <v-chart
        v-if="!loading && !error"
        class="chart"
        :option="chartOption"
        :autoresize="true"
      />
      <div v-else-if="loading" class="h-full flex items-center justify-center">
        <div class="text-gray-400">Loading...</div>
      </div>
      <div v-else-if="error" class="h-full flex items-center justify-center">
        <div class="text-red-400">{{ error }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import { useLiveDataStore } from '../../stores/liveData'
import type { PanelOptions } from '../../types'

// Register ECharts components
use([CanvasRenderer, LineChart, GridComponent, TooltipComponent, TitleComponent])

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
const dataPoints = ref<Array<{ timestamp: string; value: number }>>([])

const fieldName = computed(() => props.options.field || 'value')
const maxDataPoints = 50 // Keep last 50 points

// Watch for feed updates
watch(
  () => liveDataStore.latest,
  () => {
    if (props.feedIds.length === 0) return

    const feedId = props.feedIds[0] // Use first feed
    const feedData = liveDataStore.latest[feedId]

    if (feedData && feedData.payload) {
      const newValue = feedData.payload[fieldName.value]

      if (typeof newValue === 'number') {
        dataPoints.value.push({
          timestamp: new Date(feedData.ts).toLocaleTimeString(),
          value: newValue,
        })

        // Keep only last N points
        if (dataPoints.value.length > maxDataPoints) {
          dataPoints.value = dataPoints.value.slice(-maxDataPoints)
        }

        error.value = null
      }
    }
  },
  { deep: true }
)

// Load historical data on mount
watch(
  () => props.feedIds,
  () => {
    if (props.feedIds.length > 0) {
      const feedId = props.feedIds[0]
      const history = liveDataStore.getHistory(feedId)

      if (history.length > 0) {
        dataPoints.value = history
          .slice(-maxDataPoints)
          .map((event) => ({
            timestamp: new Date(event.ts).toLocaleTimeString(),
            value: event.payload[fieldName.value] as number,
          }))
          .filter((point) => typeof point.value === 'number')
      }
    }
  },
  { immediate: true }
)

// ECharts option
const chartOption = computed(() => {
  const color = props.options.color || '#60a5fa'
  const max = props.options.max
  const min = props.options.min ?? 0

  return {
    grid: {
      top: 20,
      right: 20,
      bottom: 30,
      left: 50,
    },
    xAxis: {
      type: 'category',
      data: dataPoints.value.map((p) => p.timestamp),
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: { color: '#9ca3af', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      max,
      min,
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: '#374151', type: 'dashed' } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1f2937',
      borderColor: '#4b5563',
      textStyle: { color: '#f3f4f6' },
    },
    series: [
      {
        data: dataPoints.value.map((p) => p.value),
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { color, width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${color}40` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
      },
    ],
  }
})
</script>

<style scoped>
.chart {
  width: 100%;
  height: 100%;
}
</style>
