<template>
  <div class="panel h-full flex flex-col">
    <div class="panel-header">
      <h3 class="panel-title">{{ title }}</h3>
    </div>

    <div class="flex-1 min-h-0">
      <v-chart
        v-if="!loading && !error && barData.length > 0"
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
      <div v-else class="h-full flex items-center justify-center">
        <div class="text-gray-500">No data</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch, ref } from 'vue'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  TitleComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import { useLiveDataStore } from '../../stores/liveData'
import type { PanelOptions } from '../../types'

// Register ECharts components
use([CanvasRenderer, BarChart, GridComponent, TooltipComponent, TitleComponent])

interface BarDataPoint {
  category: string
  value: number
}

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
const barData = ref<BarDataPoint[]>([])

// Watch for feed updates
watch(
  () => liveDataStore.latest,
  () => {
    if (props.feedIds.length === 0) return

    const feedId = props.feedIds[0]! // Use first feed
    const feedData = liveDataStore.latest[feedId]

    if (feedData && feedData.payload) {
      // Assume payload is an object with category->value mapping
      // or an array of objects with category and value fields
      const payload = feedData.payload

      if (Array.isArray(payload)) {
        barData.value = payload.map((item: any) => ({
          category: item.category || item.name || item.label || 'Unknown',
          value: item.value || 0,
        }))
      } else if (typeof payload === 'object') {
        // Convert object to array of bar data points
        barData.value = Object.entries(payload)
          .filter(([_, v]) => typeof v === 'number')
          .map(([k, v]) => ({
            category: k,
            value: v as number,
          }))
      }

      error.value = null
    }
  },
  { deep: true, immediate: true }
)

// ECharts option
const chartOption = computed(() => {
  const color = props.options?.color || '#60a5fa'

  return {
    grid: {
      top: 20,
      right: 20,
      bottom: 40,
      left: 50,
    },
    xAxis: {
      type: 'category',
      data: barData.value.map((d) => d.category),
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: {
        color: '#9ca3af',
        fontSize: 10,
        rotate: barData.value.length > 5 ? 45 : 0,
      },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#4b5563' } },
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: '#374151', type: 'dashed' } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1f2937',
      borderColor: '#4b5563',
      textStyle: { color: '#f3f4f6' },
      axisPointer: {
        type: 'shadow',
      },
    },
    series: [
      {
        data: barData.value.map((d) => d.value),
        type: 'bar',
        itemStyle: {
          color,
          borderRadius: [4, 4, 0, 0],
        },
        emphasis: {
          itemStyle: {
            color: props.options.color ? `${color}cc` : '#3b82f6',
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
