/** Mirrors the backend Pydantic schemas. */

export type CampaignStatus =
  | 'DRAFT'
  | 'READY'
  | 'RUNNING'
  | 'PAUSED'
  | 'STOPPED'
  | 'COMPLETED'
  | 'FAILED'

export type WorkflowState =
  | 'DISCOVERING'
  | 'CANDIDATE_FOUND'
  | 'EVALUATING_CANDIDATE'
  | 'CANDIDATE_ACCEPTED'
  | 'CANDIDATE_REJECTED'
  | 'FINDING_POSTS'
  | 'POST_1_FOUND'
  | 'POST_1_LIKED'
  | 'POST_2_FOUND'
  | 'POST_2_LIKED'
  | 'POST_3_FOUND'
  | 'POST_3_EVALUATING'
  | 'POST_3_ACCEPTED'
  | 'POST_3_REJECTED'
  | 'POST_3_LIKED'
  | 'COMMENT_GENERATED'
  | 'COMMENT_PENDING_APPROVAL'
  | 'COMMENT_POSTED'
  | 'COMMENT_REJECTED'
  | 'CONNECTION_SCHEDULED'
  | 'WAITING_FOR_CONNECTION'
  | 'REVALIDATING'
  | 'CONNECTION_PENDING_APPROVAL'
  | 'CONNECTION_READY'
  | 'CONNECTION_SENT'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'CANCELLED'
  | 'FAILED'

export type ApprovalMode = 'REQUIRED' | 'AUTOMATIC'
export type CommentLength = 'SHORT' | 'MEDIUM' | 'LONG'
export type CommentStyle = 'PROFESSIONAL' | 'TECHNICAL' | 'CONVERSATIONAL'
export type ConnectionMessageMode = 'NONE' | 'TEMPLATE' | 'AI_GENERATED'
export type ApprovalType = 'CANDIDATE' | 'COMMENT' | 'CONNECTION'
export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
export type ScheduledTaskStatus =
  | 'SCHEDULED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'SKIPPED'
export type ScheduledTaskType = 'CONNECTION' | 'REVALIDATION' | 'ACTIVITY_MONITOR'
export type PostProcessingStatus =
  | 'DISCOVERED'
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'EVALUATED'
  | 'LIKED'
  | 'COMMENTED'
  | 'SKIPPED'
  | 'WOULD_LIKE'
  | 'WOULD_COMMENT'
export type PostType =
  | 'TEXT'
  | 'ARTICLE'
  | 'IMAGE'
  | 'VIDEO'
  | 'POLL'
  | 'REPOST'
  | 'JOB'
  | 'ADVERTISEMENT'
  | 'OTHER'
export type ConnectionStatus = 'NOT_CONNECTED' | 'PENDING' | 'CONNECTED' | 'UNKNOWN'
export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'

export interface Page<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface ApiError {
  code: string
  message: string
  details: Record<string, unknown>
}

export interface Criteria {
  job_titles: string[]
  industries: string[]
  locations: string[]
  company_sizes: string[]
  people_keywords: string[]
  seniority_levels: string[]

  include_topics: string[]
  exclude_topics: string[]
  include_keywords: string[]
  exclude_keywords: string[]
  post_types: string[]
  minimum_relevance_score: number
  minimum_candidate_score: number
  min_post_age_hours: number | null
  max_post_age_days: number | null

  initial_posts_to_like: number
  evaluate_post_index: number
  like_evaluated_post_if_relevant: boolean
  generate_comment: boolean
  require_relevance_for_like: boolean
  require_relevance_for_comment: boolean

  comment_approval: ApprovalMode
  comment_length: CommentLength
  comment_style: CommentStyle
  candidate_approval: ApprovalMode

  connection_delay_hours: number
  revalidate_before_connection: boolean
  connection_message_mode: ConnectionMessageMode
  connection_message_template: string | null
  connection_approval: ApprovalMode

  max_people_per_day: number
  max_likes_per_day: number
  max_comments_per_day: number
  max_connections_per_day: number
  max_people_per_run: number
  min_action_delay_seconds: number
  max_action_delay_seconds: number
  daily_intake_limit?: number
  single_campaign_lock?: boolean
}

export interface CriteriaRead extends Criteria {
  id: number
}

export interface Exclusion {
  exclusion_type: string
  value: string
  reason?: string | null
}

export interface ExclusionRead extends Exclusion {
  id: number
}

export interface CampaignStats {
  candidates_discovered: number
  candidates_matched: number
  candidates_processed: number
  posts_analyzed: number
  posts_liked: number
  comments_generated: number
  comments_posted: number
  connections_scheduled: number
  connections_sent: number
  failed_actions: number
  pending_approvals: number
}

export interface Campaign {
  id: number
  name: string
  description: string | null
  instruction: string
  status: CampaignStatus
  audience_id?: number | null
  is_archived?: boolean
  dry_run: boolean
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  last_error: string | null
  criteria: CriteriaRead | null
  exclusions: ExclusionRead[]
}


export interface CampaignDetail extends Campaign {
  stats: CampaignStats
}

export interface AnalyzeResponse {
  parsed: unknown
  criteria: Criteria
  suggested_name: string
  summary: string
  provider: string
  model: string
  prompt_version: string
}

export interface Person {
  id: number
  full_name: string
  headline: string | null
  job_title: string | null
  company: string | null
  industry: string | null
  location: string | null
  profile_url: string
  avatar_url: string | null
  connection_status: ConnectionStatus
  last_activity_at: string | null
}

export interface Workflow {
  id: number
  campaign_id: number
  person_id: number
  state: WorkflowState
  previous_state: WorkflowState | null
  context: Record<string, unknown>
  consecutive_failures: number
  last_error_code: string | null
  last_error_message: string | null
  started_at: string | null
  completed_at: string | null
  updated_at: string
}

export interface WorkflowStep {
  id: number
  from_state: WorkflowState | null
  to_state: WorkflowState
  summary: string | null
  duration_ms: number | null
  created_at: string
}

export interface Candidate {
  person: Person
  campaign_id: number
  match_score: number | null
  matched_criteria: string[]
  discovery_reason: string | null
  workflow: Workflow | null
  next_action: string | null
}

export interface PostEvaluation {
  id: number
  eligible: boolean
  relevance_score: number
  topics: string[]
  reason: string
  risk_flags: string[]
  agent_name: string
  prompt_version: string
  provider: string
  model: string
  created_at: string
}

export interface Post {
  id: number
  person_id: number
  campaign_id: number | null
  external_id: string
  post_url: string | null
  content: string
  post_type: PostType
  published_at: string | null
  like_count: number | null
  comment_count: number | null
  sequence_index: number | null
  is_eligible: boolean
  ineligibility_reason: string | null
  processing_status: PostProcessingStatus
  created_at: string
  evaluations?: PostEvaluation[]
}

export interface CandidateEvaluation {
  id: number
  is_match: boolean
  score: number
  matched_criteria: string[]
  reason: string
  risk_flags: string[]
  agent_name: string
  prompt_version: string
  provider: string
  model: string
  created_at: string
}

export interface CandidateDetail extends Candidate {
  evaluation: CandidateEvaluation | null
  posts: Post[]
  timeline: WorkflowStep[]
}

export interface Approval {
  id: number
  campaign_id: number
  person_id: number
  workflow_id: number | null
  post_id: number | null
  comment_id: number | null
  connection_message_id: number | null
  approval_type: ApprovalType
  status: ApprovalStatus
  proposed_action: string
  ai_reasoning: string | null
  ai_score: number | null
  content: string | null
  context: Record<string, unknown> | null
  decided_at: string | null
  decided_by: string | null
  created_at: string
  person: Person
  campaign_name: string
  post: Post | null
  post_evaluation: PostEvaluation | null
}

export interface ScheduledAction {
  id: number
  campaign_id: number
  person_id: number | null
  workflow_id: number | null
  task_type: ScheduledTaskType
  status: ScheduledTaskStatus
  scheduled_at: string
  executed_at: string | null
  attempt_count: number
  error_code: string | null
  error_message: string | null
  created_at: string
  person: Person | null
  campaign_name: string
}

export interface Activity {
  id: number
  campaign_id: number | null
  person_id: number | null
  workflow_id: number | null
  level: LogLevel
  event_type: string
  message: string
  payload: Record<string, unknown> | null
  created_at: string
}

export interface DashboardCounters {
  active_campaigns: number
  candidates_discovered: number
  candidates_matched: number
  candidates_processed: number
  posts_analyzed: number
  posts_liked: number
  comments_generated: number
  comments_posted: number
  connections_scheduled: number
  connections_sent: number
  failed_actions: number
  actions_today: number
  pending_approvals: number
}

export interface AgentStatus {
  state: string
  campaign_id: number | null
  campaign_name: string | null
  person_id: number | null
  person_name: string | null
  workflow_state: WorkflowState | null
  current_step: string | null
  dry_run: boolean
  updated_at: string | null
}

export interface DashboardCampaign {
  id: number
  name: string
  status: CampaignStatus
  dry_run: boolean
  candidates_processed: number
  pending_approvals: number
}

export interface Dashboard {
  counters: DashboardCounters
  agent: AgentStatus
  campaigns: DashboardCampaign[]
  recent_activity: Activity[]
}

export interface FunnelPoint {
  label: string
  value: number
}

export interface TimeSeriesPoint {
  day: string
  likes: number
  comments: number
  connections: number
  failures: number
}

export interface AIUsageStats {
  requests_today: number
  requests_total: number
  by_provider: Record<string, number>
  estimated_cost_usd: number
  gpu_seconds: number
  average_latency_ms: number
  failure_rate: number
}

export interface Analytics {
  campaign_id: number | null
  funnel: FunnelPoint[]
  time_series: TimeSeriesPoint[]
  ai: AIUsageStats
  average_processing_seconds: number | null
  top_topics: FunnelPoint[]
}

export interface ProviderInfo {
  provider: string
  model: string
  supports_structured_output: boolean
  supports_tool_calling: boolean
  supports_streaming: boolean
  supports_vision: boolean
  max_context_tokens: number
}

export interface PromptInfo {
  agent_name: string
  version: string
  common_includes: string[]
  system_prompt_exists: boolean
  user_prompt_exists: boolean
  user_variables: string[]
}

export interface PlatformCapabilityInfo {
  capability: string
  support: string
  note: string | null
}

export interface AppSettings {
  app_env: string
  dry_run: boolean
  llm: ProviderInfo
  platform: string
  platform_capabilities: PlatformCapabilityInfo[]
  prompts: PromptInfo[]
  connection_delay_hours: number
  limits: Record<string, number>
}

export interface CampaignActionResponse {
  campaign: Campaign
  message: string
  task_id: string | null
}

/* ------------------------------------------------------------ auth & users */

export type UserRole = 'ADMIN' | 'USER'
export type UserStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'DEACTIVATED'

export interface UserSettings {
  default_dry_run: boolean
  max_people_per_day: number
  max_likes_per_day: number
  max_comments_per_day: number
  max_connections_per_day: number
  max_people_per_run: number
  min_action_delay_seconds: number
  max_action_delay_seconds: number
  initial_posts_to_like: number
  evaluate_post_index: number
  minimum_relevance_score: number
  minimum_candidate_score: number
  generate_comment: boolean
  connection_delay_hours: number
  comment_length: CommentLength
  comment_style: CommentStyle
  connection_message_mode: ConnectionMessageMode
  connection_message_template: string | null
  candidate_approval: ApprovalMode
  comment_approval: ApprovalMode
  connection_approval: ApprovalMode
}

export interface User {
  id: number
  email: string
  full_name: string | null
  role: UserRole
  status: UserStatus
  is_active: boolean
  email_verified: boolean
  job_title: string | null
  company: string | null
  linkedin_url: string | null
  picture_url?: string | null
  onboarding_step?: number
  timezone: string
  bio: string | null
  last_login_at: string | null
  plan_id?: string | null
  billing_cycle?: string | null
  created_at: string
  updated_at: string
}

export interface UserProfile extends User {
  settings: UserSettings | null
}

export interface AdminUser extends User {
  campaign_count: number
  active_campaign_count: number
  candidate_count: number
  deactivated_at: string | null
  deactivated_reason: string | null
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_at: string
  user: UserProfile
}

export interface AccessToken {
  access_token: string
  refresh_token: string
  token_type: string
  expires_at: string
}

export interface RegisterResponse {
  user: UserProfile
  tokens: TokenPair | null
  verification_required: boolean
  verification_token: string | null
}

export interface AuthConfig {
  allow_registration: boolean
  require_email_verification: boolean
  min_password_length: number
}

export interface AdminStats {
  total_users: number
  active_users: number
  deactivated_users: number
  pending_verification: number
  admins: number
  new_users_last_7_days: number
  total_campaigns: number
  running_campaigns: number
}

/*  platform linking */

export type PlatformProvider = 'LINKEDIN'

/** `NOT_CONNECTED` is synthesised by the API when no row exists yet. */
export type PlatformAccountStatus =
  | 'NOT_CONNECTED'
  | 'PENDING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'WARNING'
  | 'EXPIRED'

export interface PlatformAccount {
  provider: PlatformProvider
  status: PlatformAccountStatus
  connected: boolean
  connected_at: string | null
  disconnected_at: string | null
  last_error: string | null
  /** False when the server lacks its Unipile configuration. */
  linking_enabled: boolean
}

export interface HostedAuthLink {
  url: string
  expires_at: string | null
}

/* SaaS Plans */

export interface Plan {
  id: string
  name: string
  description: string
  badge: string | null
  monthly_price: number
  annual_price: number
  currency: string
  trial_days: number
  is_recommended: boolean
  is_active: boolean
  sort_order: number
  button_label: string
  max_campaigns: number
  monthly_ai_prospects: number
  daily_action_limit: number
  has_smart_pacing: boolean
  has_2fa_proxy: boolean
  has_custom_ai_prompts: boolean
  features: string[]
  created_at: string
  updated_at: string
}

export interface PlanAdmin extends Plan {
  subscriber_count: number
}

export interface PlanCreatePayload {
  id: string
  name: string
  description: string
  badge?: string | null
  monthly_price: number
  annual_price: number
  currency?: string
  trial_days?: number
  is_recommended?: boolean
  is_active?: boolean
  sort_order?: number
  button_label?: string
  max_campaigns?: number
  monthly_ai_prospects?: number
  daily_action_limit?: number
  has_smart_pacing?: boolean
  has_2fa_proxy?: boolean
  has_custom_ai_prompts?: boolean
  features?: string[]
}

export interface PlanUpdatePayload {
  name?: string
  description?: string
  badge?: string | null
  monthly_price?: number
  annual_price?: number
  currency?: string
  trial_days?: number
  is_recommended?: boolean
  is_active?: boolean
  sort_order?: number
  button_label?: string
  max_campaigns?: number
  monthly_ai_prospects?: number
  daily_action_limit?: number
  has_smart_pacing?: boolean
  has_2fa_proxy?: boolean
  has_custom_ai_prompts?: boolean
  features?: string[]
}

export interface UserPlanUpdatePayload {
  plan_id: string
  billing_cycle?: 'monthly' | 'yearly' | string
}

/* ---------------------------------------------------- onboarding & agent */

export interface OnboardingStatus {
  step: number
  completed?: boolean
  account_connected: boolean
  extension_installed: boolean
  extension_online: boolean
  connection_status?: string
  approval_mode: string | null
  account_tier: string | null
  platform_member_id: string | null
  display_name: string | null
}

export interface AgentStatusResponse {
  connected?: boolean
  connection_status?: string
  extension_online: boolean
  extension_last_seen?: string | null
  extension_version?: string | null
  account_tier?: string
  member_name?: string | null
  member_id?: string | null
  campaigns_blocked?: boolean
  block_reason?: string | null
  status?: string
  circuit_breaker_active?: boolean
}

export interface AgentHeartbeatResponse {
  status: string
  timestamp: string
  extension_online: boolean
  server_time: string
}

export interface AgentPairSessionResponse {
  status: string
  account_tier: string
  daily_limits: Record<string, number>
  platform_member_id: string
}

export interface FilterChip {
  key: string
  value: string
}

export interface PromptParseResponse {
  prompt: string
  suggested_name: string
  summary: string
  filters: Record<string, unknown>
  filter_chips: FilterChip[]
}

export interface AudienceCandidate {
  id: string
  person_id?: number | null
  name: string
  title?: string | null
  company?: string | null
  location?: string | null
  profile_url?: string | null
  avatar_url?: string | null
  fit_score: number
  why_match: string
  last_post?: string | null
  connection_status: string
  matched_criteria: string[]
  initials: string
  avatar_color: string
}

export interface AudienceSearchResponse {
  candidates: AudienceCandidate[]
  total: number
  rate_limit_remaining?: number | null
}

export interface AudienceRead {
  id: number
  name: string
  original_prompt: string
  filters_json: Record<string, unknown>
  refresh_schedule: string
  last_refreshed_at?: string | null
  is_archived: boolean
  people_count: number
  created_at: string
  updated_at: string
}

export interface AudienceDetail extends AudienceRead {
  members: AudienceCandidate[]
}

export interface AudienceCreatePayload {
  name: string
  original_prompt?: string
  filters_json?: Record<string, unknown>
  refresh_schedule?: string
  member_person_ids?: number[]
}

export interface AudienceUpdatePayload {
  name?: string
  original_prompt?: string
  filters_json?: Record<string, unknown>
  refresh_schedule?: string
  is_archived?: boolean
  member_person_ids?: number[]
}


export interface CSVImportResponse {
  imported_count: number
  skipped_count: number
  prospects: AudienceCandidate[]
}

// ------------------------------------------------------------- Content Studio --

export interface ContentPillar {
  id: number
  owner_id: number
  name: string
  target_cadence: string
  description?: string | null
  created_at: string
  updated_at: string
}

export interface ContentPillarCreatePayload {
  name: string
  target_cadence: string
  description?: string | null
}

export interface PostDraftItem {
  title: string
  content: string
  format: string
  hook?: string | null
  reading_time_seconds: number
  voice_match_score: number
  best_time: string
  suggested_slot: string
  word_count: number
}

export interface GenerateDraftsRequest {
  topic_prompt: string
  post_format?: string
  content_pillar_id?: number | null
  post_length?: string
}

export interface GenerateDraftsResponse {
  drafts: PostDraftItem[]
  model_name: string
}

export interface ShortenDraftRequest {
  content: string
  target_ratio?: number
}

export interface RegenerateDraftRequest {
  topic_prompt: string
  current_content: string
  post_format?: string
  content_pillar_id?: number | null
  post_length?: string
}

export interface SuggestedIdea {
  title: string
  preview: string
}

export interface SuggestIdeasResponse {
  ideas: (string | SuggestedIdea)[]
}

export interface SchedulePostRequest {
  title: string
  content: string
  post_format?: string
  pillar_id?: number | null
  best_time?: string | null
  scheduled_for?: string | null
  send_to_approvals?: boolean
  image_url?: string | null
}

export interface UserPost {
  id: number
  owner_id: number
  pillar_id?: number | null
  title: string
  content: string
  post_format: string
  status: string
  voice_match_score: number
  best_time?: string | null
  scheduled_for?: string | null
  published_at?: string | null
  external_id?: string | null
  metrics?: Record<string, unknown> | null
  image_url?: string | null
  created_at: string
  updated_at: string
}

export interface CalendarItem {
  day_name: string
  date_str: string
  status: 'PUBLISHED' | 'SCHEDULED' | 'WAITING_APPROVAL' | 'EMPTY' | 'REST' | 'REJECTED'
  post?: UserPost | null
}

/* ---------------------------------------------------- billing & payments */

export interface BillingConfigResponse {
  default_provider: string
  stripe_publishable_key: string
  stripe_currency: string
  razorpay_key_id?: string | null
}

export interface CreateCheckoutRequest {
  plan_id: string
  billing_cycle?: 'monthly' | 'annual'
  provider?: 'stripe' | 'razorpay'
  currency?: string
  success_url?: string
  cancel_url?: string
}

export interface CheckoutSessionResponse {
  provider: 'stripe' | 'razorpay'
  checkout_url?: string | null
  session_id?: string | null
  order_id?: string | null
  client_payload?: Record<string, unknown>
}

export interface CreatePortalRequest {
  return_url?: string
}

export interface PortalSessionResponse {
  portal_url: string
}

export interface SubscriptionResponse {
  has_subscription: boolean
  provider?: 'stripe' | 'razorpay' | null
  provider_customer_id?: string | null
  provider_subscription_id?: string | null
  plan_id: string
  plan?: Plan | null
  billing_cycle: string
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete' | 'unpaid'
  is_active: boolean
  trial_start_at?: string | null
  trial_ends_at?: string | null
  trial_days_remaining: number
  current_period_start?: string | null
  current_period_end?: string | null
  cancel_at_period_end: boolean
  campaigns_limit: number
  daily_actions_limit: number
  monthly_prospects_limit: number
}

