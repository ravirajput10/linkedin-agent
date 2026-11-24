/**
 * Where the session lives.
 *
 * `localStorage`, deliberately: the alternative that resists XSS properly is an
 * HttpOnly cookie, and that needs CSRF protection plus a same-site deployment,
 * neither of which this app has. Storing it here and keeping the access token
 * short-lived is the honest trade, not a pretence of safety.
 *
 * The in-memory copy is the one the request path reads, so a storage call is
 * not on every request and a blocked `localStorage` (private windows, some
 * embedded webviews) degrades to a session that lasts until the tab closes
 * rather than failing outright.
 */

const ACCESS_KEY = 'linkedin-agent.access-token'
const REFRESH_KEY = 'linkedin-agent.refresh-token'

export interface StoredTokens {
  accessToken: string
  refreshToken: string
}

let memory: StoredTokens | null = null

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private browsing or a full quota. The in-memory copy still works.
  }
}

export function loadTokens(): StoredTokens | null {
  if (memory) return memory
  const accessToken = readStorage(ACCESS_KEY)
  const refreshToken = readStorage(REFRESH_KEY)
  if (!accessToken || !refreshToken) return null
  memory = { accessToken, refreshToken }
  return memory
}

export function saveTokens(tokens: StoredTokens): void {
  memory = tokens
  writeStorage(ACCESS_KEY, tokens.accessToken)
  writeStorage(REFRESH_KEY, tokens.refreshToken)
  if (typeof window !== 'undefined') {
    window.postMessage(
      {
        type: 'AGENT_VERIFY_REQUEST',
        token: tokens.accessToken,
      },
      window.location.origin
    )
  }
}

export function clearTokens(): void {
  memory = null
  writeStorage(ACCESS_KEY, null)
  writeStorage(REFRESH_KEY, null)
  writeStorage('linkedin-agent.approval-mode', null)
}

export function getAccessToken(): string | null {
  return loadTokens()?.accessToken ?? null
}

/** Notified when a refresh fails, so the app can send the user to sign in. */
type SessionEndedHandler = () => void

let onSessionEnded: SessionEndedHandler | null = null

export function setSessionEndedHandler(handler: SessionEndedHandler | null): void {
  onSessionEnded = handler
}

export function endSession(): void {
  clearTokens()
  onSessionEnded?.()
}
