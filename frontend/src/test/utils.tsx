import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { AuthProvider } from '@/auth/AuthContext'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {},
) {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[route]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) }
}

/**
 * As `renderWithProviders`, wrapped in an `AuthProvider`.
 *
 * Needed by anything that calls `useAuth`, shows the signed-in user, or sits
 * behind a route guard. Pair it with `signInStorage()` and a stub for
 * `GET /auth/me` to start out signed in.
 */
export function renderWithAuth(
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {},
) {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[route]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <AuthProvider>{children}</AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  return { queryClient, ...render(ui, { wrapper: Wrapper, ...options }) }
}

type FetchRoute = { match: RegExp | string; method?: string; response: unknown; status?: number }

/**
 * Stubs `fetch` with a small routing table.
 *
 * Keeps tests describing API *shapes* rather than mocking the client module, so
 * a change to request building is caught rather than hidden.
 */
export function mockFetch(routes: FetchRoute[]) {
  const calls: { url: string; method: string; body: unknown }[] = []

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    const method = (init?.method ?? 'GET').toUpperCase()
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    })

    const route = routes.find((candidate) => {
      const methodMatches = (candidate.method ?? 'GET').toUpperCase() === method
      const urlMatches =
        typeof candidate.match === 'string'
          ? url.includes(candidate.match)
          : candidate.match.test(url)
      return methodMatches && urlMatches
    })

    if (!route) {
      return new Response(
        JSON.stringify({ code: 'NOT_FOUND', message: `No stub for ${method} ${url}`, details: {} }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify(route.response), {
      status: route.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })

  vi.stubGlobal('fetch', impl)
  return { calls, impl }
}

export const emptyPage = { items: [], total: 0, page: 1, page_size: 50 }

export const defaultCriteria = {
  job_titles: ['CTO'],
  industries: ['SaaS'],
  locations: ['India'],
  company_sizes: [],
  people_keywords: ['Java'],
  seniority_levels: ['Executive'],
  include_topics: ['Java', 'AI'],
  exclude_topics: ['Recruitment'],
  include_keywords: [],
  exclude_keywords: [],
  post_types: [],
  minimum_relevance_score: 75,
  minimum_candidate_score: 70,
  min_post_age_hours: null,
  max_post_age_days: 30,
  initial_posts_to_like: 2,
  evaluate_post_index: 3,
  like_evaluated_post_if_relevant: true,
  generate_comment: true,
  require_relevance_for_like: true,
  require_relevance_for_comment: true,
  comment_approval: 'REQUIRED' as const,
  comment_length: 'SHORT' as const,
  comment_style: 'PROFESSIONAL' as const,
  candidate_approval: 'AUTOMATIC' as const,
  connection_delay_hours: 48,
  revalidate_before_connection: true,
  connection_message_mode: 'AI_GENERATED' as const,
  connection_message_template: null,
  connection_approval: 'REQUIRED' as const,
  max_people_per_day: 20,
  max_likes_per_day: 60,
  max_comments_per_day: 15,
  max_connections_per_day: 15,
  max_people_per_run: 5,
  min_action_delay_seconds: 30,
  max_action_delay_seconds: 180,
}

export const defaultSettings = {
  app_env: 'test',
  dry_run: true,
  llm: {
    provider: 'mock',
    model: 'mock-model',
    supports_structured_output: true,
    supports_tool_calling: false,
    supports_streaming: false,
    supports_vision: false,
    max_context_tokens: 32768,
  },
  platform: 'mock',
  platform_capabilities: [{ capability: 'SEARCH', support: 'SUPPORTED', note: null }],
  prompts: [
    {
      agent_name: 'post_evaluator',
      version: 'v1',
      common_includes: ['output_rules'],
      system_prompt_exists: true,
      user_prompt_exists: true,
      user_variables: ['post_content'],
    },
  ],
  connection_delay_hours: 48,
  limits: { max_people_per_day: 20 },
}

/* ----------------------------------------------------------------- accounts */

export const mockUserSettings = {
  default_dry_run: true,
  max_people_per_day: 20,
  max_likes_per_day: 60,
  max_comments_per_day: 15,
  max_connections_per_day: 15,
  max_people_per_run: 5,
  min_action_delay_seconds: 30,
  max_action_delay_seconds: 180,
  initial_posts_to_like: 2,
  evaluate_post_index: 3,
  minimum_relevance_score: 75,
  minimum_candidate_score: 70,
  generate_comment: true,
  connection_delay_hours: 48,
  comment_length: 'SHORT' as const,
  comment_style: 'PROFESSIONAL' as const,
  connection_message_mode: 'AI_GENERATED' as const,
  connection_message_template: null,
  candidate_approval: 'AUTOMATIC' as const,
  comment_approval: 'REQUIRED' as const,
  connection_approval: 'REQUIRED' as const,
}

export function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: 'owner@example.com',
    full_name: 'Owner Person',
    role: 'USER' as const,
    status: 'ACTIVE' as const,
    is_active: true,
    email_verified: true,
    job_title: null,
    company: null,
    linkedin_url: null,
    timezone: 'UTC',
    bio: null,
    last_login_at: '2026-10-01T09:00:00Z',
    created_at: '2026-09-01T09:00:00Z',
    updated_at: '2026-10-01T09:00:00Z',
    settings: mockUserSettings,
    ...overrides,
  }
}

export function makeAdminUser(overrides: Record<string, unknown> = {}) {
  return {
    ...makeUser({ id: 2, email: 'admin@example.com', full_name: 'Admin Person', role: 'ADMIN' }),
    campaign_count: 0,
    active_campaign_count: 0,
    candidate_count: 0,
    deactivated_at: null,
    deactivated_reason: null,
    ...overrides,
  }
}

/** Puts a session in storage so `AuthProvider` starts out signed in. */
export function signInStorage(
  accessToken = 'test-access-token',
  refreshToken = 'test-refresh-token',
) {
  window.localStorage.setItem('linkedin-agent.access-token', accessToken)
  window.localStorage.setItem('linkedin-agent.refresh-token', refreshToken)
}
