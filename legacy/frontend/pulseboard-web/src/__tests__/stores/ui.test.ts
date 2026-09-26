/**
 * Unit tests for UI store
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUiStore } from '../../stores/ui'

describe('UI Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('setWsStatus', () => {
    it('should update WebSocket status', () => {
      const store = useUiStore()

      store.setWsStatus('connecting')
      expect(store.wsStatus).toBe('connecting')

      store.setWsStatus('connected')
      expect(store.wsStatus).toBe('connected')

      store.setWsStatus('disconnected')
      expect(store.wsStatus).toBe('disconnected')
    })

    it('should clear error when connected', () => {
      const store = useUiStore()

      store.error = 'Connection failed'
      store.setWsStatus('connected')

      expect(store.error).toBeNull()
    })

    it('should not clear error for other statuses', () => {
      const store = useUiStore()

      store.error = 'Connection failed'
      store.setWsStatus('disconnected')

      expect(store.error).toBe('Connection failed')
    })
  })

  describe('setError', () => {
    it('should set error message', () => {
      const store = useUiStore()

      store.setError('Test error')

      expect(store.error).toBe('Test error')
    })

    it('should clear error message', () => {
      const store = useUiStore()

      store.error = 'Test error'
      store.setError(null)

      expect(store.error).toBeNull()
    })
  })

  describe('toggleDarkMode', () => {
    it('should toggle dark mode', () => {
      const store = useUiStore()
      const initialMode = store.darkMode

      store.toggleDarkMode()

      expect(store.darkMode).toBe(!initialMode)
    })

    it('should toggle multiple times', () => {
      const store = useUiStore()

      store.darkMode = true
      store.toggleDarkMode()
      expect(store.darkMode).toBe(false)

      store.toggleDarkMode()
      expect(store.darkMode).toBe(true)
    })
  })

  describe('initial state', () => {
    it('should have correct initial values', () => {
      const store = useUiStore()

      expect(store.wsStatus).toBe('disconnected')
      expect(store.error).toBeNull()
      expect(store.darkMode).toBe(true)
    })
  })
})
