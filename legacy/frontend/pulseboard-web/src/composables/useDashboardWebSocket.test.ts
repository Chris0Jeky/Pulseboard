import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useDashboardWebSocket } from './useDashboardWebSocket'
import { useUiStore } from '../stores/ui'

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

describe('useDashboardWebSocket reconnect backoff', () => {
  let wrapper: VueWrapper | undefined
  let api: ReturnType<typeof useDashboardWebSocket> | undefined
  let setTimeoutSpy: ReturnType<typeof vi.spyOn> | undefined
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    setActivePinia(createPinia())
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    setTimeoutSpy.mockClear()
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

  function closeLatest() {
    const latest = MockWebSocket.instances[MockWebSocket.instances.length - 1]
    expect(latest).toBeDefined()
    latest.onclose?.({} as CloseEvent)
  }

  it('retries with backoff then stops at max', () => {
    const pinia = createPinia()
    setActivePinia(pinia)

    wrapper = mount(
      {
        template: '<div />',
        setup() {
          api = useDashboardWebSocket('dashboard-1')
          return {}
        },
      },
      { global: { plugins: [pinia] } },
    )
    expect(api).toBeDefined()

    const uiStore = useUiStore()
    const setErrorSpy = vi.spyOn(uiStore, 'setError')

    // Ignore any setTimeout calls from mounting; only reconnect delays matter.
    setTimeoutSpy!.mockClear()

    api!.connect()
    expect(MockWebSocket.instances).toHaveLength(1)

    const expectedDelays = [2000, 4000, 8000, 16000, 32000]

    for (const delay of expectedDelays) {
      closeLatest()
      // A reconnect is scheduled with exponential backoff.
      const scheduled = setTimeoutSpy!.mock.calls.map((call) => call[1])
      expect(scheduled[scheduled.length - 1]).toBe(delay)
      vi.advanceTimersByTime(delay)
    }

    expect(MockWebSocket.instances).toHaveLength(6)
    expect(setTimeoutSpy!.mock.calls.map((call) => call[1])).toEqual(expectedDelays)

    // 6th close exhausts the 5 retries and surfaces a terminal error.
    closeLatest()
    expect(setErrorSpy).toHaveBeenCalledWith('Unable to connect to server')

    // No further reconnect is scheduled after the terminal error.
    const timeoutCallsAfterError = setTimeoutSpy!.mock.calls.length
    vi.advanceTimersByTime(120_000)
    expect(MockWebSocket.instances).toHaveLength(6)
    expect(setTimeoutSpy!.mock.calls.length).toBe(timeoutCallsAfterError)
  })
})
