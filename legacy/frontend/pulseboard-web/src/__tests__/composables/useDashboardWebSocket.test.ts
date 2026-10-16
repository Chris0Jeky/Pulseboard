import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useDashboardWebSocket } from '../../composables/useDashboardWebSocket'
import { useUiStore } from '../../stores/ui'
import { useLiveDataStore } from '../../stores/liveData'

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  url: string
  readyState = MockWebSocket.CLOSED
  onopen: ((ev: Event) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  send = vi.fn()
  close = vi.fn()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }
}

describe('useDashboardWebSocket', () => {
  let wrapper: VueWrapper | undefined
  let api: ReturnType<typeof useDashboardWebSocket> | undefined
  let setIntervalSpy: ReturnType<typeof vi.spyOn> | undefined
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    setActivePinia(createPinia())
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    setIntervalSpy.mockClear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    api = undefined
    vi.unstubAllGlobals()
    globalThis.WebSocket = originalWebSocket
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  function mountSocket(dashboardId = 'dashboard-1') {
    const pinia = createPinia()
    setActivePinia(pinia)
    wrapper = mount(
      {
        template: '<div />',
        setup() {
          api = useDashboardWebSocket(dashboardId)
          return {}
        },
      },
      { global: { plugins: [pinia] } },
    )
    expect(api).toBeDefined()
    return { uiStore: useUiStore(), liveDataStore: useLiveDataStore() }
  }

  function latestSocket() {
    const latest = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(latest).toBeDefined()
    return latest
  }

  function openLatest() {
    const socket = latestSocket()
    socket.readyState = MockWebSocket.OPEN
    socket.onopen?.({} as Event)
  }

  it('sends ping every 30s and ignores pong messages', () => {
    const { liveDataStore } = mountSocket()
    const applyFeedUpdateSpy = vi.spyOn(liveDataStore, 'applyFeedUpdate')

    api!.connect()
    openLatest()

    // Ping is scheduled on a 30s interval.
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000)

    const socket = latestSocket()
    vi.advanceTimersByTime(30_000)
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ping' }))

    vi.advanceTimersByTime(30_000)
    expect(socket.send).toHaveBeenCalledTimes(2)

    // A feed_update still reaches the store, proving the spy is live.
    socket.onmessage?.({
      data: JSON.stringify({
        type: 'feed_update',
        feed_id: 'feed-1',
        ts: new Date().toISOString(),
        payload: { value: 1 },
      }),
    } as MessageEvent)
    expect(applyFeedUpdateSpy).toHaveBeenCalledTimes(1)
    applyFeedUpdateSpy.mockClear()

    // Pong frames only confirm liveness and must not touch the store.
    socket.onmessage?.({ data: JSON.stringify({ type: 'pong' }) } as MessageEvent)
    expect(applyFeedUpdateSpy).not.toHaveBeenCalled()
    expect(liveDataStore.getHistory('__pong__')).toEqual([])
  })

  it('transitions to error state on websocket error', () => {
    const { uiStore } = mountSocket()

    api!.connect()
    latestSocket().onerror?.({} as Event)

    expect(uiStore.wsStatus).toBe('error')
    expect(uiStore.error).toBe('WebSocket connection error')
  })
})
