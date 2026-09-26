import { vi } from 'vitest'

// Mock fetch globally
global.fetch = vi.fn()

// Mock WebSocket
global.WebSocket = vi.fn(() => ({
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  send: vi.fn(),
  close: vi.fn(),
  readyState: WebSocket.OPEN,
})) as any

// Suppress console errors in tests
global.console.error = vi.fn()
