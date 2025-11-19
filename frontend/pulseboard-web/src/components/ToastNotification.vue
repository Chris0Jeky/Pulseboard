<template>
  <div
    :class="[
      'toast-notification',
      `toast-${notification.type}`,
      { 'toast-enter': isEntering, 'toast-exit': isExiting },
    ]"
    @click="handleDismiss"
  >
    <div class="toast-icon">
      <svg
        v-if="notification.type === 'success'"
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <svg
        v-else-if="notification.type === 'error'"
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <svg
        v-else-if="notification.type === 'warning'"
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <svg
        v-else
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    </div>

    <div class="toast-content">
      <p class="toast-message">{{ notification.message }}</p>
    </div>

    <button class="toast-close" @click.stop="handleDismiss" aria-label="Dismiss">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Notification } from '../stores/notifications'

const props = defineProps<{
  notification: Notification
}>()

const emit = defineEmits<{
  dismiss: [id: string]
}>()

const isEntering = ref(true)
const isExiting = ref(false)

onMounted(() => {
  // Trigger enter animation
  setTimeout(() => {
    isEntering.value = false
  }, 10)
})

function handleDismiss() {
  isExiting.value = true
  setTimeout(() => {
    emit('dismiss', props.notification.id)
  }, 300)
}
</script>

<style scoped>
.toast-notification {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: 0.75rem;
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2);
  cursor: pointer;
  transition: all 0.3s ease;
  border: 1px solid;
  min-width: 300px;
  max-width: 400px;
}

.toast-notification:hover {
  transform: translateX(-4px);
  box-shadow: 0 12px 30px -5px rgba(0, 0, 0, 0.4), 0 10px 12px -6px rgba(0, 0, 0, 0.3);
}

/* Success */
.toast-success {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15), rgba(5, 150, 105, 0.15));
  border-color: rgba(16, 185, 129, 0.3);
  color: #10b981;
}

/* Error */
.toast-error {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(220, 38, 38, 0.15));
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

/* Warning */
.toast-warning {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.15), rgba(217, 119, 6, 0.15));
  border-color: rgba(245, 158, 11, 0.3);
  color: #f59e0b;
}

/* Info */
.toast-info {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(37, 99, 235, 0.15));
  border-color: rgba(59, 130, 246, 0.3);
  color: #3b82f6;
}

.toast-icon {
  flex-shrink: 0;
}

.toast-content {
  flex: 1;
  min-width: 0;
}

.toast-message {
  font-size: 0.875rem;
  line-height: 1.4;
  margin: 0;
  font-weight: 500;
  word-wrap: break-word;
}

.toast-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: currentColor;
  opacity: 0.6;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 0.375rem;
  transition: all 0.2s ease;
}

.toast-close:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.1);
}

/* Animations */
.toast-enter {
  transform: translateX(100%);
  opacity: 0;
}

.toast-exit {
  transform: translateX(100%);
  opacity: 0;
}
</style>
