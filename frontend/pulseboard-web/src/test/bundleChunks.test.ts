import { describe, expect, it } from 'vitest'
import { workbenchChunk } from '../../build/chunks'

describe('workbench production chunk boundaries', () => {
  it('isolates the measured chart engines on POSIX and Windows paths', () => {
    expect(workbenchChunk('/repo/node_modules/echarts/lib/core/echarts.js')).toBe('charts-echarts')
    expect(workbenchChunk('C:\\repo\\node_modules\\zrender\\lib\\Element.js')).toBe('charts-renderer')
  })

  it('leaves the Vue adapter, application and framework modules to Rollup', () => {
    expect(workbenchChunk('/repo/node_modules/vue-echarts/dist/index.js')).toBeUndefined()
    expect(workbenchChunk('/repo/src/views/DashboardLiveView.vue')).toBeUndefined()
    expect(workbenchChunk('/repo/node_modules/vue/dist/vue.runtime.esm-bundler.js')).toBeUndefined()
  })
})
