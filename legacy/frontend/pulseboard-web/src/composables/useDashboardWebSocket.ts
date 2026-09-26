/**
 * Composable for managing dashboard WebSocket connections
 */

import { ref, onUnmounted } from 'vue'
import { useLiveDataStore } from '../stores/liveData'
import { useUiStore } from '../stores/ui'
import apiClient from '../api/client'
import type { FeedEventMessage } from '../types'

export function useDashboardWebSocket(dashboardId: string) {
  const liveDataStore = useLiveDataStore()
  const uiStore = useUiStore()

  const ws = ref<WebSocket | null>(null)
  const reconnectAttempts = ref(0)
  const maxReconnectAttempts = 5
  const reconnectDelay = 2000

  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let pingInterval: ReturnType<typeof setInterval> | null = null

  function connect() {
    if (ws.value?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected')
      return
    }

    const url = apiClient.getWebSocketUrl(dashboardId)
    console.log(`Connecting to WebSocket: ${url}`)

    uiStore.setWsStatus('connecting')
    ws.value = new WebSocket(url)

    ws.value.onopen = () => {
      console.log('WebSocket connected')
      uiStore.setWsStatus('connected')
      reconnectAttempts.value = 0

      // Start ping interval to keep connection alive
      if (pingInterval) clearInterval(pingInterval)
      pingInterval = setInterval(() => {
        if (ws.value?.readyState === WebSocket.OPEN) {
          ws.value.send(JSON.stringify({ type: 'ping' }))
        }
      }, 30000) // Ping every 30 seconds
    }

    ws.value.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as FeedEventMessage

        if (message.type === 'feed_update') {
          liveDataStore.applyFeedUpdate({
            feed_id: message.feed_id,
            ts: message.ts,
            payload: message.payload,
          })
        } else if (message.type === 'pong') {
          // Pong received, connection is alive
        }
      } catch (e) {
        console.error('Error parsing WebSocket message:', e)
      }
    }

    ws.value.onerror = (error) => {
      console.error('WebSocket error:', error)
      uiStore.setWsStatus('error')
      uiStore.setError('WebSocket connection error')
    }

    ws.value.onclose = () => {
      console.log('WebSocket closed')
      uiStore.setWsStatus('disconnected')

      // Clear ping interval
      if (pingInterval) {
        clearInterval(pingInterval)
        pingInterval = null
      }

      // Attempt reconnection
      if (reconnectAttempts.value < maxReconnectAttempts) {
        const delay = reconnectDelay * Math.pow(2, reconnectAttempts.value)
        console.log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts.value + 1}/${maxReconnectAttempts})`)

        reconnectTimeout = setTimeout(() => {
          reconnectAttempts.value++
          connect()
        }, delay)
      } else {
        console.error('Max reconnection attempts reached')
        uiStore.setError('Unable to connect to server')
      }
    }
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }

    if (pingInterval) {
      clearInterval(pingInterval)
      pingInterval = null
    }

    if (ws.value) {
      reconnectAttempts.value = maxReconnectAttempts // Prevent auto-reconnect
      ws.value.close()
      ws.value = null
    }

    uiStore.setWsStatus('disconnected')
  }

  // Auto-disconnect on unmount
  onUnmounted(() => {
    disconnect()
  })

  function manualReconnect() {
    reconnectAttempts.value = 0 // Reset reconnect attempts
    disconnect()
    setTimeout(() => {
      connect()
    }, 100)
  }

  return {
    connect,
    disconnect,
    manualReconnect,
    reconnectAttempts,
    ws,
  }
}
