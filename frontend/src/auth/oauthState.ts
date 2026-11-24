/**
 * Ties a LinkedIn OAuth callback to the tab that started it.
 *
 * The backend signs `state`, which rejects forged or stale values, but a
 * signature cannot tell whose browser a callback landed in: an attacker can
 * fetch a valid state themselves and send a victim their own callback URL,
 * signing the victim into the attacker's account. Keeping a copy here and
 * requiring the callback to match it closes that.
 */

const KEY = 'linkedin-agent.oauth-state'

export function rememberOAuthState(state: string): void {
  try {
    window.sessionStorage.setItem(KEY, state)
  } catch {
    // Storage blocked: the callback will fail the check and say so.
  }
}

/** True when `state` is the one this tab issued. Single use either way. */
export function consumeOAuthState(state: string | null): boolean {
  let expected: string | null = null
  try {
    expected = window.sessionStorage.getItem(KEY)
    window.sessionStorage.removeItem(KEY)
  } catch {
    return false
  }
  return Boolean(state) && state === expected
}
