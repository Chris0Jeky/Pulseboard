import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useLiveDataStore } from '../../stores/liveData'
import PanelStat from './PanelStat.vue'
import PanelTimeseries from './PanelTimeseries.vue'

// Exercise the real component/store behavior without opening a canvas or socket.
vi.mock('vue-echarts', () => ({
  default: {
    name: 'VChart',
    props: ['option', 'autoresize'],
    template: '<div data-testid="timeseries-chart" />',
  },
}))

describe('panels with an explicitly missing feed', () => {
  let wrapper: VueWrapper | undefined
  let store: ReturnType<typeof useLiveDataStore>
  let tick: number

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLiveDataStore()
    tick = 0
  })

  afterEach(() => wrapper?.unmount())

  function show(component: typeof PanelStat | typeof PanelTimeseries) {
    wrapper = mount(component, { props: { title: 'Metric', feedIds: ['feed-1'] } })
    return wrapper
  }

  async function publish(payload: Record<string, unknown>) {
    store.applyFeedUpdate({
      feed_id: 'feed-1',
      ts: new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString(),
      payload,
    })
    await nextTick()
  }

  it('clears the old stat and trend on missing data, then recovers without a stale comparison', async () => {
    const panel = show(PanelStat)
    await publish({ value: 100 })
    await publish({ value: 200 })
    expect(panel.find('.stat-value').text()).toBe('200')
    expect(panel.find('.mt-2').exists()).toBe(true)

    await publish({ status: 'missing', error: 'Upstream field unavailable' })
    expect(panel.text()).toContain('Upstream field unavailable')
    expect(panel.find('.stat-value').exists()).toBe(false)

    await publish({ value: 300 })
    expect(panel.find('.stat-value').text()).toBe('300')
    expect(panel.find('.mt-2').exists()).toBe(false)
    expect(panel.text()).not.toContain('Upstream field unavailable')
  })

  it('honors a cached missing status even when the payload also contains a numeric value', async () => {
    await publish({ status: 'missing', error: 'Unavailable', value: 999 })
    const panel = show(PanelStat)
    expect(panel.text()).toContain('Unavailable')
    expect(panel.find('.stat-value').exists()).toBe(false)
  })

  it('hides old time-series points on missing data and starts a fresh series on recovery', async () => {
    const panel = show(PanelTimeseries)
    await publish({ value: 100 })
    await publish({ value: 200 })
    expect(panel.findComponent({ name: 'VChart' }).props('option').series[0].data).toEqual([100, 200])

    await publish({ status: 'missing', error: 'Upstream field unavailable' })
    expect(panel.text()).toContain('Upstream field unavailable')
    expect(panel.findComponent({ name: 'VChart' }).exists()).toBe(false)

    await publish({ value: 300 })
    expect(panel.findComponent({ name: 'VChart' }).props('option').series[0].data).toEqual([300])
    expect(panel.text()).not.toContain('Upstream field unavailable')
  })

  it('does not restore stale historical points when the latest cached event is missing', async () => {
    await publish({ value: 100 })
    await publish({ status: 'missing', error: 'Latest sample unavailable' })
    const panel = show(PanelTimeseries)
    expect(panel.text()).toContain('Latest sample unavailable')
    expect(panel.findComponent({ name: 'VChart' }).exists()).toBe(false)
  })

  for (const reload of ['remount', 'feedIds refresh'] as const) {
    it(`keeps the recovered time-series buffer after ${reload}`, async () => {
      let panel = show(PanelTimeseries)
      await publish({ value: 100 })
      await publish({ status: 'missing', error: 'Unavailable', value: 999 })
      await publish({ value: 300 })
      expect(panel.findComponent({ name: 'VChart' }).props('option').series[0].data).toEqual([300])

      if (reload === 'remount') {
        panel.unmount()
        panel = show(PanelTimeseries)
      } else {
        await panel.setProps({ feedIds: ['feed-1'] })
      }

      expect(panel.findComponent({ name: 'VChart' }).props('option').series[0].data).toEqual([300])
      expect(store.getHistory('feed-1').map(event => event.payload.value)).toEqual([100, 999, 300])
    })
  }

  for (const [name, component] of [['stat', PanelStat], ['time-series', PanelTimeseries]] as const) {
    it(`shows No data for a ${name} missing event without usable error text`, async () => {
      const panel = show(component)
      await publish({ value: 100 })
      await publish({ status: 'missing', error: { detail: 'not a display string' } })
      expect(panel.text()).toContain('No data')
      expect(panel.find('.stat-value').exists()).toBe(false)
      expect(panel.findComponent({ name: 'VChart' }).exists()).toBe(false)
    })
  }
})
