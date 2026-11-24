import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// jsdom has no EventSource; the activity stream hook must degrade quietly.
class EventSourceStub {
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: (() => void) | null = null
  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {}
}

vi.stubGlobal('EventSource', EventSourceStub)

// The token store keeps an in-memory copy, so clearing storage is not enough
// to stop one test's session leaking into the next.
afterEach(async () => {
  window.localStorage.clear()
  const { clearTokens, setSessionEndedHandler } = await import('@/services/tokens')
  clearTokens()
  setSessionEndedHandler(null)
})
