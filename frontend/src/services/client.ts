import type { AccessToken, ApiError } from '@/types/api'

import { clearTokens, endSession, loadTokens, saveTokens } from '@/services/tokens'

export const API_BASE = import.meta.env.VITE_API_BASE || '/linkedin-agent/api'

export class ApiRequestError extends Error {
  readonly code: string
  readonly status: number
  readonly details: Record<string, unknown>

  constructor(status: number, error: ApiError) {
    super(error.message)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = error.code
    this.details = error.details ?? {}
  }
}

async function parseError(response: Response): Promise<ApiRequestError> {
  let body: ApiError = {
    code: 'INTERNAL_ERROR',
    message: `Request failed with status ${response.status}.`,
    details: {},
  }
  try {
    const parsed = await response.json()
    if (parsed && typeof parsed === 'object' && 'code' in parsed) {
      body = parsed as ApiError
    }
  } catch {
    // Keep the generic message when the body is not JSON.
  }
  return new ApiRequestError(response.status, body)
}

type RequestOptions = {
  method?: string
  body?: unknown
  signal?: AbortSignal
  params?: Record<string, string | number | boolean | undefined | null>
  /** Skips the Authorization header and the refresh retry. */
  anonymous?: boolean
}

function withQuery(path: string, params?: RequestOptions['params']): string {
  if (!params) return path
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value))
    }
  }
  const query = search.toString()
  return query ? `${path}?${query}` : path
}

/**
 * In-flight refresh, shared by every caller.
 *
 * Several queries usually fail together when the access token expires. Without
 * this, each would start its own refresh, and because refresh tokens rotate,
 * the losers would present a token the server has already retired — which it
 * reads as a leak and answers by revoking every session. One refresh, awaited
 * by all of them.
 */
let refreshInFlight: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const tokens = loadTokens()
  if (!tokens) return null

  const response = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refreshToken }),
  })

  if (!response.ok) {
    clearTokens()
    return null
  }

  const body = (await response.json()) as AccessToken
  saveTokens({ accessToken: body.access_token, refreshToken: body.refresh_token })
  return body.access_token
}

function refreshOnce(): Promise<string | null> {
  refreshInFlight ??= refreshAccessToken().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function send(path: string, options: RequestOptions, token: string | null) {
  const { method = 'GET', body, signal, params } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`

  return fetch(`${API_BASE}${withQuery(path, params)}`, {
    method,
    signal,
    headers: Object.keys(headers).length ? headers : undefined,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const anonymous = options.anonymous ?? false
  let token = anonymous ? null : (loadTokens()?.accessToken ?? null)

  let response = await send(path, options, token)

  if (response.status === 401 && !anonymous && token) {
    const refreshed = await refreshOnce()
    if (refreshed) {
      token = refreshed
      response = await send(path, options, token)
    }
    if (response.status === 401) {
      // The refresh failed or the new token is no good either: the session is
      // genuinely over. Tell the app once rather than letting every query show
      // its own error.
      endSession()
    }
  }

  if (!response.ok) {
    throw await parseError(response)
  }
  if (response.status === 204) {
    return undefined as T
  }
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, params?: RequestOptions['params']) => request<T>(path, { params }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}

/** For the sign-in and registration screens, which have no token yet. */
export const anonApi = {
  get: <T>(path: string, params?: RequestOptions['params']) =>
    request<T>(path, { params, anonymous: true }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body, anonymous: true }),
}
