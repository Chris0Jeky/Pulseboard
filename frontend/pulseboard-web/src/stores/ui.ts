/**
 * UI state store
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WSStatus } from '../types'

export const useUiStore = defineStore('ui', () => {
  // State
  const wsStatus = ref<WSStatus['status']>('disconnected')
  const error = ref<string | null>(null)
  const darkMode = ref(true) // Default to dark mode

  // Actions
  function setWsStatus(status: WSStatus['status']) {
    wsStatus.value = status
    if (status === 'connected') {
      error.value = null
    }
  }

  function setError(message: string | null) {
    error.value = message
  }

  function toggleDarkMode() {
    darkMode.value = !darkMode.value
    updateDarkModeClass()
  }

  function updateDarkModeClass() {
    if (darkMode.value) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }

  // Initialize dark mode class
  updateDarkModeClass()

  return {
    // State
    wsStatus,
    error,
    darkMode,

    // Actions
    setWsStatus,
    setError,
    toggleDarkMode,
  }
})
