import { defineStore } from 'pinia'
import { ref } from 'vue'

export type NotificationType = 'success' | 'error' | 'warning' | 'info'

export interface Notification {
  id: string
  type: NotificationType
  message: string
  duration?: number
  timestamp: number
}

export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<Notification[]>([])
  let nextId = 1

  function add(type: NotificationType, message: string, duration = 5000) {
    const id = `toast-${nextId++}`
    const notification: Notification = {
      id,
      type,
      message,
      duration,
      timestamp: Date.now(),
    }

    notifications.value.push(notification)

    // Auto-dismiss after duration
    if (duration > 0) {
      setTimeout(() => {
        remove(id)
      }, duration)
    }

    return id
  }

  function remove(id: string) {
    const index = notifications.value.findIndex((n) => n.id === id)
    if (index !== -1) {
      notifications.value.splice(index, 1)
    }
  }

  function clear() {
    notifications.value = []
  }

  // Convenience methods
  function success(message: string, duration?: number) {
    return add('success', message, duration)
  }

  function error(message: string, duration?: number) {
    return add('error', message, duration || 7000) // Errors stay longer
  }

  function warning(message: string, duration?: number) {
    return add('warning', message, duration)
  }

  function info(message: string, duration?: number) {
    return add('info', message, duration)
  }

  return {
    notifications,
    add,
    remove,
    clear,
    success,
    error,
    warning,
    info,
  }
})
