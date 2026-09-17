import { describe, expect, it } from 'vitest'
import { workbenchChunk } from '../../vite.config'

describe('workbench production chunk boundaries', () => {
  it('isolates each measured chart package on POSIX and Windows paths', () => {
    expect(workbenchChunk('/repo/node_modules/echarts/lib/core/echarts.js')).toBe('charts-echarts')
    expect(workbenchChunk('C:\\repo\\node_modules\\zrender\\lib\\Element.js')).toBe('charts-renderer')
    expect(workbenchChunk('/repo/node_modules/vue-echarts/dist/index.js')).toBe('charts-vue')
  })

  it('leaves application and unrelated framework modules to Rollup', () => {
    expect(workbenchChunk('/repo/src/views/DashboardLiveView.vue')).toBeUndefined()
    expect(workbenchChunk('/repo/node_modules/vue/dist/vue.runtime.esm-bundler.js')).toBeUndefined()
  })
})
