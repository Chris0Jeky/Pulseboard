/**
 * Unit tests for live data store
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLiveDataStore } from '../../stores/liveData'
import type { FeedEvent } from '../../types'

describe('Live Data Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('applyFeedUpdate', () => {
    it('should update latest event', () => {
      const store = useLiveDataStore()
      const event: FeedEvent = {
        feed_id: 'feed-1',
        ts: '2024-01-01T00:00:00Z',
        payload: { cpu: 50 },
      }

      store.applyFeedUpdate(event)

      expect(store.latest['feed-1']).toEqual(event)
    })

    it('should add event to history', () => {
      const store = useLiveDataStore()
      const event: FeedEvent = {
        feed_id: 'feed-1',
        ts: '2024-01-01T00:00:00Z',
        payload: { cpu: 50 },
      }

      store.applyFeedUpdate(event)

      expect(store.history['feed-1']).toHaveLength(1)
      expect(store.history['feed-1'][0]).toEqual(event)
    })

    it('should trim history to max size', () => {
      const store = useLiveDataStore()

      // Add 105 events (maxHistorySize is 100)
      for (let i = 0; i < 105; i++) {
        store.applyFeedUpdate({
          feed_id: 'feed-1',
          ts: `2024-01-01T00:${String(i).padStart(2, '0')}:00Z`,
          payload: { value: i },
        })
      }

      expect(store.history['feed-1']).toHaveLength(100)
      // Should keep the most recent events
      expect(store.history['feed-1'][0].payload.value).toBe(5)
      expect(store.history['feed-1'][99].payload.value).toBe(104)
    })

    it('should handle multiple feeds', () => {
      const store = useLiveDataStore()

      store.applyFeedUpdate({
        feed_id: 'feed-1',
        ts: '2024-01-01T00:00:00Z',
        payload: { cpu: 50 },
      })

      store.applyFeedUpdate({
        feed_id: 'feed-2',
        ts: '2024-01-01T00:00:00Z',
        payload: { ram: 70 },
      })

      expect(store.latest['feed-1']).toBeDefined()
      expect(store.latest['feed-2']).toBeDefined()
      expect(store.latest['feed-1'].payload.cpu).toBe(50)
      expect(store.latest['feed-2'].payload.ram).toBe(70)
    })
  })

  describe('setHistory', () => {
    it('should set history for a feed', () => {
      const store = useLiveDataStore()
      const events: FeedEvent[] = [
        { feed_id: 'feed-1', ts: '2024-01-01T00:00:00Z', payload: { value: 1 } },
        { feed_id: 'feed-1', ts: '2024-01-01T00:01:00Z', payload: { value: 2 } },
        { feed_id: 'feed-1', ts: '2024-01-01T00:02:00Z', payload: { value: 3 } },
      ]

      store.setHistory('feed-1', events)

      expect(store.history['feed-1']).toEqual(events)
      expect(store.latest['feed-1']).toEqual(events[2])
    })

    it('should trim history if exceeds max size', () => {
      const store = useLiveDataStore()
      const events: FeedEvent[] = Array.from({ length: 150 }, (_, i) => ({
        feed_id: 'feed-1',
        ts: `2024-01-01T${String(i).padStart(2, '0')}:00:00Z`,
        payload: { value: i },
      }))

      store.setHistory('feed-1', events)

      expect(store.history['feed-1']).toHaveLength(100)
      expect(store.history['feed-1'][0].payload.value).toBe(50)
    })
  })

  describe('getLatest', () => {
    it('should return latest event for feed', () => {
      const store = useLiveDataStore()
      const event: FeedEvent = {
        feed_id: 'feed-1',
        ts: '2024-01-01T00:00:00Z',
        payload: { cpu: 50 },
      }

      store.applyFeedUpdate(event)

      expect(store.getLatest('feed-1')).toEqual(event)
    })

    it('should return undefined for unknown feed', () => {
      const store = useLiveDataStore()

      expect(store.getLatest('unknown')).toBeUndefined()
    })
  })

  describe('getHistory', () => {
    it('should return history for feed', () => {
      const store = useLiveDataStore()
      const events: FeedEvent[] = [
        { feed_id: 'feed-1', ts: '2024-01-01T00:00:00Z', payload: { value: 1 } },
        { feed_id: 'feed-1', ts: '2024-01-01T00:01:00Z', payload: { value: 2 } },
      ]

      events.forEach((e) => store.applyFeedUpdate(e))

      expect(store.getHistory('feed-1')).toEqual(events)
    })

    it('should return empty array for unknown feed', () => {
      const store = useLiveDataStore()

      expect(store.getHistory('unknown')).toEqual([])
    })
  })

  describe('clearFeedData', () => {
    it('should clear data for specific feed', () => {
      const store = useLiveDataStore()

      store.applyFeedUpdate({
        feed_id: 'feed-1',
        ts: '2024-01-01T00:00:00Z',
        payload: { cpu: 50 },
      })

      store.applyFeedUpdate({
        feed_id: 'feed-2',
        ts: '2024-01-01T00:00:00Z',
        payload: { ram: 70 },
      })

      store.clearFeedData('feed-1')

      expect(store.latest['feed-1']).toBeUndefined()
      expect(store.history['feed-1']).toBeUndefined()
      expect(store.latest['feed-2']).toBeDefined()
    })
  })

  describe('clearAll', () => {
    it('should clear all feed data', () => {
      const store = useLiveDataStore()

      store.applyFeedUpdate({
        feed_id: 'feed-1',
        ts: '2024-01-01T00:00:00Z',
        payload: { cpu: 50 },
      })

      store.applyFeedUpdate({
        feed_id: 'feed-2',
        ts: '2024-01-01T00:00:00Z',
        payload: { ram: 70 },
      })

      store.clearAll()

      expect(Object.keys(store.latest)).toHaveLength(0)
      expect(Object.keys(store.history)).toHaveLength(0)
    })
  })
})
