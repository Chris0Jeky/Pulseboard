<template>
  <div class="toast-container">
    <TransitionGroup name="toast-list">
      <ToastNotification
        v-for="notification in notificationsStore.notifications"
        :key="notification.id"
        :notification="notification"
        @dismiss="handleDismiss"
      />
    </TransitionGroup>
  </div>
</template>

<script setup lang="ts">
import { useNotificationsStore } from '../stores/notifications'
import ToastNotification from './ToastNotification.vue'

const notificationsStore = useNotificationsStore()

function handleDismiss(id: string) {
  notificationsStore.remove(id)
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  pointer-events: none;
}

.toast-container > * {
  pointer-events: auto;
}

/* List transition animations */
.toast-list-enter-active,
.toast-list-leave-active {
  transition: all 0.3s ease;
}

.toast-list-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.toast-list-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

.toast-list-move {
  transition: transform 0.3s ease;
}
</style>
