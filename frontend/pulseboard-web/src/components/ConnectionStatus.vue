<template>
  <div class="connection-status">
    <!-- Status Badge -->
    <button
      @click="showDetails = !showDetails"
      class="status-badge"
      :class="statusClass"
      :title="statusTitle"
    >
      <!-- Connected -->
      <div v-if="uiStore.wsStatus === 'connected'" class="status-indicator connected">
        <div class="status-dot"></div>
      </div>
      <!-- Connecting -->
      <div v-else-if="uiStore.wsStatus === 'connecting'" class="status-indicator connecting">
        <div class="status-dot pulsing"></div>
      </div>
      <!-- Disconnected -->
      <div v-else-if="uiStore.wsStatus === 'disconnected'" class="status-indicator disconnected">
        <div class="status-dot"></div>
      </div>
      <!-- Error -->
      <div v-else-if="uiStore.wsStatus === 'error'" class="status-indicator error">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>

      <span class="status-text">{{ statusText }}</span>
    </button>

    <!-- Details Dropdown -->
    <Transition name="dropdown">
      <div v-if="showDetails" class="status-details" @click.stop>
        <div class="details-header">
          <h3 class="text-sm font-semibold text-white mb-1">Connection Status</h3>
          <p class="text-xs text-gray-400">{{ statusDescription }}</p>
        </div>

        <!-- Reconnect Info (if applicable) -->
        <div v-if="reconnectAttempts > 0 && uiStore.wsStatus !== 'connected'" class="reconnect-info">
          <div class="flex items-center gap-2">
            <div class="loading-spinner"></div>
            <span class="text-xs text-gray-300">Reconnecting... (Attempt {{ reconnectAttempts }}/5)</span>
          </div>
        </div>

        <!-- Error Message -->
        <div v-if="uiStore.error" class="error-message">
          <svg class="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-xs text-red-300">{{ uiStore.error }}</span>
        </div>

        <!-- Manual Reconnect Button -->
        <button
          v-if="uiStore.wsStatus !== 'connected' && uiStore.wsStatus !== 'connecting'"
          @click="handleReconnect"
          class="reconnect-button"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Retry Connection
        </button>
      </div>
    </Transition>

    <!-- Click Outside to Close -->
    <div
      v-if="showDetails"
      class="overlay"
      @click="showDetails = false"
    ></div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUiStore } from '../stores/ui'

const props = defineProps<{
  onReconnect?: () => void
  reconnectAttempts?: number
}>()

const uiStore = useUiStore()
const showDetails = ref(false)

const statusClass = computed(() => {
  switch (uiStore.wsStatus) {
    case 'connected':
      return 'status-connected'
    case 'connecting':
      return 'status-connecting'
    case 'disconnected':
      return 'status-disconnected'
    case 'error':
      return 'status-error'
    default:
      return ''
  }
})

const statusText = computed(() => {
  switch (uiStore.wsStatus) {
    case 'connected':
      return 'Live'
    case 'connecting':
      return 'Connecting'
    case 'disconnected':
      return 'Offline'
    case 'error':
      return 'Error'
    default:
      return 'Unknown'
  }
})

const statusTitle = computed(() => {
  switch (uiStore.wsStatus) {
    case 'connected':
      return 'Real-time connection active'
    case 'connecting':
      return 'Connecting to server'
    case 'disconnected':
      return 'No real-time updates'
    case 'error':
      return 'Connection error'
    default:
      return ''
  }
})

const statusDescription = computed(() => {
  switch (uiStore.wsStatus) {
    case 'connected':
      return 'Receiving live data updates'
    case 'connecting':
      return 'Establishing connection...'
    case 'disconnected':
      return 'Not connected to server'
    case 'error':
      return 'Connection encountered an error'
    default:
      return ''
  }
})

function handleReconnect() {
  if (props.onReconnect) {
    props.onReconnect()
  }
  showDetails.value = false
}
</script>

<style scoped>
.connection-status {
  position: relative;
}

.status-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
  border: 1px solid;
  backdrop-filter: blur(8px);
}

.status-badge:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.status-connected {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1), rgba(5, 150, 105, 0.1));
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.status-connecting {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.1), rgba(217, 119, 6, 0.1));
  border-color: rgba(245, 158, 11, 0.3);
  color: #f59e0b;
}

.status-disconnected {
  background: linear-gradient(135deg, rgba(107, 114, 128, 0.1), rgba(75, 85, 99, 0.1));
  border-color: rgba(107, 114, 128, 0.3);
  color: #6b7280;
}

.status-error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(220, 38, 38, 0.1));
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.status-indicator {
  display: flex;
  align-items: center;
  justify-center;
}

.status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background-color: currentColor;
}

.status-dot.pulsing {
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.status-text {
  font-weight: 600;
  letter-spacing: 0.025em;
}

.status-details {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  min-width: 280px;
  background: linear-gradient(135deg, rgba(31, 41, 55, 0.98), rgba(17, 24, 39, 0.98));
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 0.75rem;
  padding: 1rem;
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(12px);
  z-index: 100;
}

.details-header {
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 0.75rem;
}

.reconnect-info {
  padding: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
}

.loading-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(245, 158, 11, 0.3);
  border-top-color: #f59e0b;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-message {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
}

.reconnect-button {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(37, 99, 235, 0.15));
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 0.5rem;
  color: #3b82f6;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.2s ease;
  cursor: pointer;
}

.reconnect-button:hover {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(37, 99, 235, 0.25));
  border-color: rgba(59, 130, 246, 0.5);
  transform: translateY(-1px);
}

.overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
}

/* Dropdown transition */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: all 0.2s ease;
}

.dropdown-enter-from {
  opacity: 0;
  transform: translateY(-0.5rem);
}

.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}
</style>
