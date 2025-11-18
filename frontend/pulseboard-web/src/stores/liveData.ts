/**
 * Live data store for feed events
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { FeedEvent } from '../types'

export const useLiveDataStore = defineStore('liveData', () => {
  // State
  const latest = ref<Record<string, FeedEvent>>({})
  const history = ref<Record<string, FeedEvent[]>>({})
  const maxHistorySize = 100 // Keep last 100 events per feed

  // Actions
  function applyFeedUpdate(event: FeedEvent) {
    const feedId = event.feed_id

    // Update latest
    latest.value[feedId] = event

    // Update history
    if (!history.value[feedId]) {
      history.value[feedId] = []
    }

    history.value[feedId].push(event)

    // Trim history
    if (history.value[feedId].length > maxHistorySize) {
      history.value[feedId] = history.value[feedId].slice(-maxHistorySize)
    }
  }

  function setHistory(feedId: string, events: FeedEvent[]) {
    history.value[feedId] = events.slice(-maxHistorySize)
    const lastEvent = events[events.length - 1]
    if (lastEvent) {
      latest.value[feedId] = lastEvent
    }
  }

  function getLatest(feedId: string): FeedEvent | undefined {
    return latest.value[feedId]
  }

  function getHistory(feedId: string): FeedEvent[] {
    return history.value[feedId] || []
  }

  function clearFeedData(feedId: string) {
    delete latest.value[feedId]
    delete history.value[feedId]
  }

  function clearAll() {
    latest.value = {}
    history.value = {}
  }

  return {
    // State
    latest,
    history,

    // Actions
    applyFeedUpdate,
    setHistory,
    getLatest,
    getHistory,
    clearFeedData,
    clearAll,
  }
})
