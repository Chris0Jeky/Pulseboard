import { describe, it, expect, beforeEach } from 'vitest'
import { useLiveDataStore } from './liveData'
import { createTestPinia, createMockFeedEvent } from '../test/helpers'

describe('LiveData Store', () => {
  beforeEach(() => {
    createTestPinia()
  })

  describe('applyFeedUpdate', () => {
    it('should store latest feed data', () => {
      const store = useLiveDataStore()
      const event = createMockFeedEvent({
        feed_id: 'feed-1',
        payload: { value: 42 },
      })

      store.applyFeedUpdate(event)

      expect(store.latest['feed-1']).toEqual(event)
    })

    it('should append to history with limit', () => {
      const store = useLiveDataStore()

      // Add 150 events (exceeding the 100 limit)
      for (let i = 0; i < 150; i++) {
        store.applyFeedUpdate(
          createMockFeedEvent({
            feed_id: 'feed-1',
            payload: { value: i },
          })
        )
      }

      // Should only keep last 100
      expect(store.history['feed-1'].length).toBe(100)
      expect(store.history['feed-1'][0].payload.value).toBe(50)
      expect(store.history['feed-1'][99].payload.value).toBe(149)
    })

    it('should update latest when new event arrives', () => {
      const store = useLiveDataStore()

      const event1 = createMockFeedEvent({
        feed_id: 'feed-1',
        payload: { value: 1 },
      })
      const event2 = createMockFeedEvent({
        feed_id: 'feed-1',
        payload: { value: 2 },
      })

      store.applyFeedUpdate(event1)
      expect(store.latest['feed-1'].payload.value).toBe(1)

      store.applyFeedUpdate(event2)
      expect(store.latest['feed-1'].payload.value).toBe(2)
    })

    it('should handle multiple feeds independently', () => {
      const store = useLiveDataStore()

      const event1 = createMockFeedEvent({ feed_id: 'feed-1', payload: { a: 1 } })
      const event2 = createMockFeedEvent({ feed_id: 'feed-2', payload: { b: 2 } })

      store.applyFeedUpdate(event1)
      store.applyFeedUpdate(event2)

      expect(store.latest['feed-1'].payload).toEqual({ a: 1 })
      expect(store.latest['feed-2'].payload).toEqual({ b: 2 })
      expect(store.history['feed-1'].length).toBe(1)
      expect(store.history['feed-2'].length).toBe(1)
    })
  })

  describe('getLatest', () => {
    it('should return latest feed data', () => {
      const store = useLiveDataStore()
      const event = createMockFeedEvent({
        feed_id: 'feed-1',
        payload: { value: 99 },
      })

      store.applyFeedUpdate(event)

      const latest = store.getLatest('feed-1')
      expect(latest).toEqual(event)
    })

    it('should return undefined for unknown feed', () => {
      const store = useLiveDataStore()

      const latest = store.getLatest('unknown-feed')
      expect(latest).toBeUndefined()
    })
  })

  describe('getHistory', () => {
    it('should return feed history', () => {
      const store = useLiveDataStore()

      for (let i = 0; i < 5; i++) {
        store.applyFeedUpdate(
          createMockFeedEvent({
            feed_id: 'feed-1',
            payload: { value: i },
          })
        )
      }

      const history = store.getHistory('feed-1')
      expect(history.length).toBe(5)
      expect(history[0].payload.value).toBe(0)
      expect(history[4].payload.value).toBe(4)
    })

    it('should return empty array for unknown feed', () => {
      const store = useLiveDataStore()

      const history = store.getHistory('unknown-feed')
      expect(history).toEqual([])
    })
  })

  describe('clear', () => {
    it('should clear all feed data', () => {
      const store = useLiveDataStore()

      store.applyFeedUpdate(createMockFeedEvent({ feed_id: 'feed-1' }))
      store.applyFeedUpdate(createMockFeedEvent({ feed_id: 'feed-2' }))

      expect(Object.keys(store.latest).length).toBe(2)

      store.clear()

      expect(Object.keys(store.latest).length).toBe(0)
      expect(Object.keys(store.history).length).toBe(0)
    })
  })
})
