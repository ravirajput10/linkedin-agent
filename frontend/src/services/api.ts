import { anonApi, api } from '@/services/client'
import type {
  Activity,
  AdminStats,
  AdminUser,
  AgentHeartbeatResponse,
  AgentPairSessionResponse,
  AgentStatusResponse,
  AuthConfig,
  Analytics,
  AnalyzeResponse,
  Approval,
  ApprovalType,
  AppSettings,
  Campaign,
  CampaignActionResponse,
  CampaignDetail,
  CampaignStatus,
  Candidate,
  CandidateDetail,
  Criteria,
  Dashboard,
  Exclusion,
  HostedAuthLink,
  OnboardingStatus,
  Page,
  Plan,
  PlanAdmin,
  PlanCreatePayload,
  PlanUpdatePayload,
  PlatformAccount,
  Post,
  RegisterResponse,
  ScheduledAction,
  AudienceCreatePayload,
  AudienceDetail,
  AudienceRead,
  AudienceSearchResponse,
  AudienceUpdatePayload,
  CSVImportResponse,
  PromptParseResponse,
  TokenPair,
  BillingConfigResponse,
  CreateCheckoutRequest,
  CheckoutSessionResponse,
  CreatePortalRequest,
  PortalSessionResponse,
  SubscriptionResponse,
  UserPlanUpdatePayload,
  UserProfile,
  UserRole,
  UserSettings,
  UserStatus,
  CalendarItem,
  ContentPillar,
  ContentPillarCreatePayload,
  GenerateDraftsRequest,
  GenerateDraftsResponse,
  PostDraftItem,
  RegenerateDraftRequest,
  SchedulePostRequest,
  ShortenDraftRequest,
  SuggestIdeasResponse,
  UserPost,
} from '@/types/api'

/** A type alias, not an interface: TS only gives aliases an implicit index
 *  signature, which the query-string builder needs. */
export type ListParams = {
  page?: number
  page_size?: number
}

export const campaignsApi = {
  list: (params: ListParams & { status?: CampaignStatus } = {}) =>
    api.get<Page<Campaign>>('/campaigns', params),

  get: (id: number) => api.get<CampaignDetail>(`/campaigns/${id}`),

  analyze: (instruction: string) =>
    api.post<AnalyzeResponse>('/campaigns/analyze', { instruction }),

  reanalyze: (id: number, instruction?: string) =>
    api.post<AnalyzeResponse>(`/campaigns/${id}/analyze`, instruction ? { instruction } : undefined),

  create: (payload: {
    name: string
    instruction: string
    description?: string
    dry_run?: boolean
    audience_id?: number
    criteria?: Criteria
    exclusions?: Exclusion[]
  }) => api.post<Campaign>('/campaigns', payload),

  update: (
    id: number,
    payload: Partial<{
      name: string
      instruction: string
      description: string
      dry_run: boolean
      audience_id: number
      is_archived: boolean
      criteria: Criteria
      exclusions: Exclusion[]
    }>,
  ) => api.put<Campaign>(`/campaigns/${id}`, payload),

  remove: (id: number) => api.delete<{ message: string }>(`/campaigns/${id}`),

  duplicate: (id: number) => api.post<Campaign>(`/campaigns/${id}/duplicate`),
  archive: (id: number) => api.post<Campaign>(`/campaigns/${id}/archive`),
  start: (id: number) => api.post<CampaignActionResponse>(`/campaigns/${id}/start`),
  pause: (id: number) => api.post<CampaignActionResponse>(`/campaigns/${id}/pause`),
  resume: (id: number) => api.post<CampaignActionResponse>(`/campaigns/${id}/resume`),
  analytics: (id: number, days?: number) =>
    api.get<Analytics>(`/campaigns/${id}/analytics`, { days }),
  stop: (id: number) => api.post<CampaignActionResponse>(`/campaigns/${id}/stop`),
  runNow: (id: number) => api.post<CampaignActionResponse>(`/campaigns/${id}/run`),

  candidates: (id: number, params: ListParams & { state?: string; min_score?: number } = {}) =>
    api.get<Page<Candidate>>(`/campaigns/${id}/candidates`, params),

  skipProspect: (campaignId: number, personId: number) =>
    api.post<{ message: string }>(`/campaigns/${campaignId}/prospects/${personId}/skip`),

  removeProspect: (campaignId: number, personId: number) =>
    api.delete<{ message: string }>(`/campaigns/${campaignId}/prospects/${personId}`),

  addProspect: (
    campaignId: number,
    data: { profile_url: string; full_name?: string; job_title?: string; company?: string }
  ) => api.post<{ message: string }>(`/campaigns/${campaignId}/prospects`, data),

  reportReply: (campaignId: number, personId: number) =>
    api.post<{ message: string }>(`/campaigns/${campaignId}/events/reply-received`, { person_id: personId }),
}


export const candidatesApi = {
  list: (params: ListParams & { campaign_id?: number; search?: string } = {}) =>
    api.get<Page<Candidate>>('/candidates', params),

  get: (personId: number, campaignId?: number) =>
    api.get<CandidateDetail>(`/candidates/${personId}`, { campaign_id: campaignId }),

  posts: (personId: number, params: ListParams & { eligible_only?: boolean } = {}) =>
    api.get<Page<Post>>(`/candidates/${personId}/posts`, params),
}

export const postsApi = {
  list: (
    params: ListParams & {
      campaign_id?: number
      person_id?: number
      status?: string
      eligible_only?: boolean
      min_score?: number
    } = {},
  ) => api.get<Page<Post>>('/posts', params),

  get: (id: number) => api.get<Post>(`/posts/${id}`),
}

export const approvalsApi = {
  list: (
    params: ListParams & { type?: ApprovalType; status?: string; campaign_id?: number } = {},
  ) => api.get<Page<Approval>>('/approvals', params),

  counts: () => api.get<Record<ApprovalType, number>>('/approvals/counts'),

  get: (id: number) => api.get<Approval>(`/approvals/${id}`),

  approve: (id: number, payload?: { edited_content?: string; note?: string }) =>
    api.post<Approval>(`/approvals/${id}/approve`, payload ?? {}),

  reject: (id: number, payload?: { note?: string }) =>
    api.post<Approval>(`/approvals/${id}/reject`, payload ?? {}),

  skipPerson: (id: number, payload?: { note?: string }) =>
    api.post<Approval>(`/approvals/${id}/skip-person`, payload ?? {}),

  bulkApprove: (payload?: { type?: ApprovalType; approval_ids?: number[] }) =>
    api.post<{ approved_count: number; items: number[] }>('/approvals/bulk-approve', payload ?? {}),

  expireStale: (olderThanHours?: number) =>
    api.post<{ expired_count: number; items: number[] }>('/approvals/expire-stale', {
      older_than_hours: olderThanHours ?? 48,
    }),

  regenerate: (id: number, payload?: { feedback?: string }) =>
    api.post<Approval>(`/approvals/${id}/regenerate`, payload ?? {}),
}

export const scheduledActionsApi = {
  list: (params: ListParams & { campaign_id?: number; status?: string; type?: string } = {}) =>
    api.get<Page<ScheduledAction>>('/scheduled-actions', params),

  cancel: (id: number) => api.post<ScheduledAction>(`/scheduled-actions/${id}/cancel`),

  reschedule: (id: number, scheduledAt: string) =>
    api.post<ScheduledAction>(`/scheduled-actions/${id}/reschedule`, {
      scheduled_at: scheduledAt,
    }),

  runNow: (id: number) => api.post<ScheduledAction>(`/scheduled-actions/${id}/run-now`),
}

export const activityApi = {
  list: (
    params: ListParams & { campaign_id?: number; level?: string; event_type?: string } = {},
  ) => api.get<Page<Activity>>('/activity', params),

  exportCsvUrl: (params?: { campaign_id?: number; level?: string; event_type?: string }) => {
    const search = new URLSearchParams()
    if (params?.campaign_id) search.set('campaign_id', String(params.campaign_id))
    if (params?.level) search.set('level', params.level)
    if (params?.event_type) search.set('event_type', params.event_type)
    const qs = search.toString()
    return `/api/activity/export${qs ? `?${qs}` : ''}`
  },
}

export const dashboardApi = {
  get: () => api.get<Dashboard>('/dashboard'),
  analytics: (params: { campaign_id?: number; days?: number } = {}) =>
    api.get<Analytics>('/analytics', params),
}

export const settingsApi = {
  get: () => api.get<AppSettings>('/settings'),
}

export const authApi = {
  /** Public: the sign-in screen reads this before anyone has a token. */
  config: () => anonApi.get<AuthConfig>('/auth/config'),

  securityConfig: () => anonApi.get<{ turnstile_site_key: string }>('/auth/security-config'),

  login: (email: string, password: string, turnstile_token?: string) =>
    anonApi.post<TokenPair>('/auth/login', { email, password, turnstile_token }),

  register: (payload: {
    email: string
    password: string
    full_name?: string
    plan_id?: string
    billing_cycle?: string
    turnstile_token?: string
  }) => anonApi.post<RegisterResponse>('/auth/register', payload),

  verifyEmail: (token: string) =>
    anonApi.post<{ message: string }>('/auth/verify-email', { token }),

  resendVerification: (email: string) =>
    anonApi.post<{ message: string; detail: string | null }>('/auth/resend-verification', {
      email,
    }),

  me: () => api.get<UserProfile>('/auth/me'),

  updateProfile: (payload: {
    full_name?: string | null
    job_title?: string | null
    company?: string | null
    linkedin_url?: string | null
    timezone?: string
    bio?: string | null
  }) => api.put<UserProfile>('/auth/me', payload),

  changePassword: (current_password: string, new_password: string) =>
    api.put<{ message: string; detail: string | null }>('/auth/me/password', {
      current_password,
      new_password,
    }),

  settings: () => api.get<UserSettings>('/auth/me/settings'),

  updateSettings: (payload: Partial<UserSettings>) =>
    api.put<UserSettings>('/auth/me/settings', payload),

  logout: (refresh_token: string) =>
    api.post<{ message: string }>('/auth/logout', { refresh_token }),

  logoutEverywhere: () => api.post<{ message: string }>('/auth/logout-all'),

  linkedinAuthorize: () =>
    anonApi.get<{ authorize_url: string; state: string }>('/auth/linkedin/authorize'),

  linkedinCallback: (code: string, state: string, redirect_uri?: string) =>
    anonApi.post<TokenPair>('/auth/linkedin/callback', { code, state, redirect_uri }),

  onboarding: () => api.get<OnboardingStatus>('/auth/me/onboarding'),

  updateOnboarding: (payload: { step: number; approval_mode?: string }) =>
    api.put<OnboardingStatus>('/auth/me/onboarding', payload),

  deleteWorkspace: () => api.delete<{ message: string }>('/auth/me/workspace'),
}

export const agentApi = {
  status: () => api.get<AgentStatusResponse>('/agent/status'),

  heartbeat: (payload: { version?: string; member_id?: string; active_tab_session?: string } = {}) =>
    api.post<AgentHeartbeatResponse>('/agent/heartbeat', payload),

  pairSession: (payload: {
    member_id: string
    full_name?: string
    profile_url?: string
    account_tier?: string
  }) => api.post<AgentPairSessionResponse>('/agent/pair-session', payload),

  sessionExpired: (reason?: string) =>
    api.post<{ message: string; paused_campaign_count: number }>('/agent/session-expired', { reason }),

  disconnect: () => api.post<{ message: string }>('/agent/disconnect'),

  circuitBreaker: (reason?: string) =>
    api.post<{ message: string }>('/agent/circuit-breaker', { reason }),

  pauseAll: () => api.post<AgentStatusResponse>('/agent/pause-all'),

  resumeAll: () => api.post<AgentStatusResponse>('/agent/resume-all'),

  withdrawStaleInvites: (maxAgeDays = 14) =>
    api.post<{ message: string; detail: string }>(`/agent/withdraw-stale-invites?max_age_days=${maxAgeDays}`),

  getWarmupStatus: () =>
    api.get<{
      warmup_enabled: boolean
      days_active: number
      warmup_day: number
      warmup_total_days: number
      multiplier: number
      percentage: number
      base_limits: Record<string, number>
      effective_limits: Record<string, number>
    }>('/agent/warmup-status'),

  acceptRiskTerms: (version = '1.0') =>
    api.post<{ message: string; detail: string }>(`/agent/accept-risk-terms?version=${version}`),
}

export const adminApi = {
  stats: () => api.get<AdminStats>('/admin/stats'),

  listUsers: (
    params: ListParams & {
      search?: string
      role?: UserRole
      status?: UserStatus
      is_active?: boolean
    } = {},
  ) => api.get<Page<AdminUser>>('/admin/users', params),

  getUser: (id: number) => api.get<AdminUser>(`/admin/users/${id}`),

  createUser: (payload: {
    email: string
    password: string
    full_name?: string
    role?: UserRole
    is_active?: boolean
  }) => api.post<AdminUser>('/admin/users', payload),

  updateUser: (
    id: number,
    payload: Partial<{
      full_name: string
      role: UserRole
      job_title: string
      company: string
      timezone: string
      email_verified: boolean
    }>,
  ) => api.put<AdminUser>(`/admin/users/${id}`, payload),

  activate: (id: number) => api.post<AdminUser>(`/admin/users/${id}/activate`),

  deactivate: (id: number, reason?: string) =>
    api.post<AdminUser>(`/admin/users/${id}/deactivate`, { reason }),

  resetPassword: (id: number, new_password: string) =>
    api.post<{ message: string; detail: string | null }>(`/admin/users/${id}/reset-password`, {
      new_password,
    }),

  removeUser: (id: number) => api.delete<{ message: string }>(`/admin/users/${id}`),

  userSettings: (id: number) => api.get<UserSettings>(`/admin/users/${id}/settings`),

  userCampaigns: (id: number, params: ListParams & { status?: CampaignStatus } = {}) =>
    api.get<Page<Campaign>>(`/admin/users/${id}/campaigns`, params),

  plans: {
    list: () => api.get<PlanAdmin[]>('/admin/plans'),
    get: (id: string) => api.get<Plan>(`/admin/plans/${id}`),
    create: (payload: PlanCreatePayload) => api.post<Plan>('/admin/plans', payload),
    update: (id: string, payload: PlanUpdatePayload) => api.put<Plan>(`/admin/plans/${id}`, payload),
    toggleActive: (id: string) => api.patch<Plan>(`/admin/plans/${id}/toggle-active`),
    reorder: (planIds: string[]) =>
      api.post<PlanAdmin[]>('/admin/plans/reorder', { plan_ids: planIds }),
    delete: (id: string) => api.delete<{ message: string }>(`/admin/plans/${id}`),
    assignUserPlan: (userId: number, payload: UserPlanUpdatePayload) =>
      api.patch<AdminUser>(`/admin/users/${userId}/plan`, payload),
  },
}

export const plansApi = {
  list: () => api.get<Plan[]>('/plans'),
}

export const integrationsApi = {
  linkedin: () => api.get<PlatformAccount>('/integrations/linkedin'),

  /** Returns a single-use Unipile hosted-auth URL to redirect the browser to. */
  connectLinkedIn: (reconnect = false) =>
    api.post<HostedAuthLink>('/integrations/linkedin/connect', { reconnect }),

  /** Reads the real state back from Unipile. This is what binds the account
   *  on a server with no public webhook address. */
  refreshLinkedIn: (payload?: { account_id?: string }) =>
    api.post<PlatformAccount>('/integrations/linkedin/refresh', payload),

  disconnectLinkedIn: () => api.delete<PlatformAccount>('/integrations/linkedin'),
}

export const audiencesApi = {
  list: () => api.get<AudienceRead[]>('/audiences'),

  get: (id: number) => api.get<AudienceDetail>(`/audiences/${id}`),

  create: (payload: AudienceCreatePayload) =>
    api.post<AudienceRead>('/audiences', payload),

  update: (id: number, payload: AudienceUpdatePayload) =>
    api.put<AudienceRead>(`/audiences/${id}`, payload),

  duplicate: (id: number) =>
    api.post<AudienceRead>(`/audiences/${id}/duplicate`),

  archive: (id: number) =>
    api.post<AudienceRead>(`/audiences/${id}/archive`),

  delete: (id: number) =>
    api.delete<{ message: string }>(`/audiences/${id}`),

  parsePrompt: (prompt: string) =>
    api.post<PromptParseResponse>('/audiences/parse-prompt', { prompt }),

  search: (payload: {
    prompt?: string
    filters?: Record<string, unknown>
    audience_id?: number
    exclude_connections?: boolean
    exclude_active_campaigns?: boolean
    limit?: number
  }) => api.post<AudienceSearchResponse>('/audiences/search', payload),

  refresh: (id: number) =>
    api.post<AudienceDetail>(`/audiences/${id}/refresh`),

  assignCampaign: (audienceId: number, campaignId: number, personIds: number[]) =>
    api.post<{ message: string }>(`/audiences/${audienceId}/assign-campaign`, {
      campaign_id: campaignId,
      person_ids: personIds,
    }),

  exclude: (audienceId: number, personIds: number[], reason?: string) =>
    api.post<{ message: string }>(`/audiences/${audienceId}/exclude`, {
      person_ids: personIds,
      reason,
    }),

  importCsv: (csvText: string, audienceId?: number) =>
    api.post<CSVImportResponse>('/audiences/import-csv', {
      csv_text: csvText,
      audience_id: audienceId,
    }),
}

export const contentStudioApi = {
  getPillars: () =>
    api.get<ContentPillar[]>('/content-pillars'),

  createPillar: (payload: ContentPillarCreatePayload) =>
    api.post<ContentPillar>('/content-pillars', payload),

  deletePillar: (pillarId: number) =>
    api.delete<{ message: string }>(`/content-pillars/${pillarId}`),

  generateDrafts: (payload: GenerateDraftsRequest) =>
    api.post<GenerateDraftsResponse>('/content-studio/generate-drafts', payload),

  shortenDraft: (payload: ShortenDraftRequest) =>
    api.post<PostDraftItem>('/content-studio/shorten', payload),

  regenerateDraft: (payload: RegenerateDraftRequest) =>
    api.post<PostDraftItem>('/content-studio/regenerate', payload),

  suggestIdeas: (pillar?: string) =>
    api.get<SuggestIdeasResponse>('/content-studio/ideas', pillar ? { pillar } : {}),

  schedulePost: (payload: SchedulePostRequest) =>
    api.post<UserPost>('/content-studio/posts', payload),

  listPosts: (params?: { status?: string }) =>
    api.get<UserPost[]>('/content-studio/posts', params || {}),

  getCalendar: () =>
    api.get<CalendarItem[]>('/content-studio/calendar'),

  approvePost: (postId: number) =>
    api.post<UserPost>(`/content-studio/posts/${postId}/approve`),

  rejectPost: (postId: number) =>
    api.post<UserPost>(`/content-studio/posts/${postId}/reject`),

  deletePost: (postId: number) =>
    api.delete<{ message: string }>(`/content-studio/posts/${postId}`),
}

/* ----------------------------------------------------------------- billing */

export const billingApi = {
  getConfig: () => api.get<BillingConfigResponse>('/billing/config'),

  getSubscription: () => api.get<SubscriptionResponse>('/billing/subscription'),

  createCheckoutSession: (payload: CreateCheckoutRequest) =>
    api.post<CheckoutSessionResponse>('/billing/create-checkout-session', payload),

  createPortalSession: (payload?: CreatePortalRequest) =>
    api.post<PortalSessionResponse>('/billing/create-portal-session', payload || {}),

  confirmSession: (sessionId: string) =>
    api.post<SubscriptionResponse>('/billing/confirm-session', { session_id: sessionId }),
}

