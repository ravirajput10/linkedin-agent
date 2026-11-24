import { useState, useEffect } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Bot, Sliders, CreditCard } from 'lucide-react'
import { billingApi } from '@/services/api'
import { SubscriptionCard } from '@/components/billing/SubscriptionCard'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState, LoadingState } from '@/components/ui'
import { settingsApi, authApi, agentApi } from '@/services/api'
import { humanize } from '@/utils/format'
import { DangerZone } from '@/components/DangerZone'
import type { AppSettings } from '@/types/api'

const SUPPORT_TONES: Record<string, 'positive' | 'caution' | 'critical' | 'neutral'> = {
  SUPPORTED: 'positive',
  MANUAL_REQUIRED: 'caution',
  UNSUPPORTED: 'critical',
}

type ApprovalSetting = 'AUTOMATIC' | 'MANUAL'

export function Settings() {
  const auth = useOptionalAuth()
  const isAdmin = auth?.isAdmin ?? false

  if (isAdmin) {
    return <Navigate to="/admin/settings" replace />
  }

  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'billing' ? 'billing' : 'preferences'
  const [activeTab, setActiveTab] = useState<'preferences' | 'system' | 'billing'>(initialTab)
  const [isConfirming, setIsConfirming] = useState(false)
  const isCheckoutSuccess = searchParams.get('status') === 'success'

  useEffect(() => {
    const tabParam = searchParams.get('tab')
    if (tabParam === 'billing' || tabParam === 'system' || tabParam === 'preferences') {
      setActiveTab(tabParam)
    }

    const sessionId = searchParams.get('session_id')
    if (sessionId && searchParams.get('status') === 'success') {
      setIsConfirming(true)
      billingApi.confirmSession(sessionId)
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] })
          queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
        })
        .catch((err) => {
          console.error('Session confirmation error:', err)
        })
        .finally(() => {
          setIsConfirming(false)
        })
    }
  }, [searchParams, queryClient])

  const { data: subscription, isLoading: isSubscriptionLoading, refetch: refetchSubscription } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: billingApi.getSubscription,
    enabled: !!auth?.isAuthenticated,
  })
  const [saveSuccess, setSaveSuccess] = useState(false)

  const { data: serverSettings, isLoading, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  // Human approval controls: 'AUTOMATIC' vs 'MANUAL' (Needs approval)
  const [approvals, setApprovals] = useState<Record<string, ApprovalSetting>>({
    likes: 'AUTOMATIC',
    profileViews: 'AUTOMATIC',
    aiComments: 'MANUAL',
    connectionNotes: 'MANUAL',
    messages: 'MANUAL',
    yourPosts: 'MANUAL',
  })

  // Daily safety limits
  const [limits, setLimits] = useState({
    likes: 60,
    comments: 20,
    connectionRequests: 25,
    messages: 30,
    profileViews: 80,
    posts: 1,
    startHour: '09:00',
    endHour: '18:00',
    timezone: 'IST (UTC+5:30)',
    warmupMode: true,
  })

  // How the AI writes for you
  const [aiWriting, setAiWriting] = useState({
    aboutYou:
      auth?.user?.bio ||
      'Founder at Divergent Software Labs. We build AI agents and custom software for B2B companies.',
    neverSay: 'Pitch services in comments, use emojis, mention pricing',
    language: 'English (match the post\'s language)',
  })

  // Notifications
  const [notifications, setNotifications] = useState({
    browserApproval: true,
    emailDigest: true,
    linkedinWarning: true,
  })

  // Load stored preferences if available
  useEffect(() => {
    try {
      const stored = localStorage.getItem('user_settings')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed.approvals) setApprovals((prev) => ({ ...prev, ...parsed.approvals }))
        if (parsed.limits) setLimits((prev) => ({ ...prev, ...parsed.limits }))
        if (parsed.aiWriting) setAiWriting((prev) => ({ ...prev, ...parsed.aiWriting }))
        if (parsed.notifications) setNotifications((prev) => ({ ...prev, ...parsed.notifications }))
      } else if (serverSettings?.limits) {
        setLimits((prev) => ({
          ...prev,
          likes: serverSettings.limits?.max_likes_per_day ?? prev.likes,
          comments: serverSettings.limits?.max_comments_per_day ?? prev.comments,
          connectionRequests: serverSettings.limits?.max_connections_per_day ?? prev.connectionRequests,
        }))
      }
    } catch {
      // Ignore parse errors
    }
  }, [serverSettings])

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Persist to local storage
      localStorage.setItem(
        'user_settings',
        JSON.stringify({ approvals, limits, aiWriting, notifications }),
      )

      // Sync bio if updated
      if (auth?.isAuthenticated && aiWriting.aboutYou) {
        try {
          await authApi.updateProfile({ bio: aiWriting.aboutYou })
        } catch {
          // Non-blocking
        }
      }

      // Sync server-backed safety limits if available
      if (auth?.isAuthenticated) {
        try {
          await authApi.updateSettings({
            max_likes_per_day: limits.likes,
            max_comments_per_day: limits.comments,
            max_connections_per_day: limits.connectionRequests,
            candidate_approval: approvals.profileViews === 'AUTOMATIC' ? 'AUTOMATIC' : 'REQUIRED',
            comment_approval: approvals.aiComments === 'AUTOMATIC' ? 'AUTOMATIC' : 'REQUIRED',
            connection_approval: approvals.connectionNotes === 'AUTOMATIC' ? 'AUTOMATIC' : 'REQUIRED',
          })
        } catch {
          // Non-blocking
        }
      }
    },
    onSuccess: () => {
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  if (isLoading) return <LoadingState />
  if (error || !serverSettings) return <ErrorState error={error} onRetry={() => refetch()} />



  return (
    <div className="space-y-4 pb-12">
      {/* Page Title, Navigation Tabs & Save Button in ONE clean header row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Settings
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Account connection, approval rules, safety limits and how the AI writes for you.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* Tab Switcher */}
          <div className="inline-flex rounded-lg border border-slate-200 dark:border-border bg-slate-100/80 dark:bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('preferences')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                activeTab === 'preferences'
                  ? 'bg-white dark:bg-card text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Sliders className="size-3.5" />
              <span>Preferences</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('system')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                activeTab === 'system'
                  ? 'bg-white dark:bg-card text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Bot className="size-3.5" />
              <span>System & AI</span>
              {serverSettings.dry_run && (
                <span className="rounded-full bg-amber-100 dark:bg-amber-950/60 px-1.5 py-0.2 text-[9px] text-amber-700 dark:text-amber-400 font-medium">
                  Dry Run
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('billing')}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-all ${
                activeTab === 'billing'
                  ? 'bg-white dark:bg-card text-slate-900 dark:text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <CreditCard className="size-3.5" />
              <span>Billing & Plans</span>
              {subscription?.status === 'trialing' && (
                <span className="rounded-full bg-blue-100 dark:bg-blue-950/60 px-1.5 py-0.2 text-[9px] text-blue-700 dark:text-blue-400 font-medium">
                  Trial
                </span>
              )}
            </button>
          </div>

          {/* Compact Save Button in Header */}
          {activeTab === 'preferences' && (
            <Button
              onClick={() => saveMutation.mutate()}
              loading={saveMutation.isPending}
              className="bg-[#2445C8] hover:bg-[#1d38a8] text-white px-3.5 py-1.5 h-8 text-xs font-semibold shadow-xs"
            >
              {saveSuccess ? (
                <>
                  <Check className="mr-1 size-3.5 text-emerald-300" />
                  Saved
                </>
              ) : (
                'Save settings'
              )}
            </Button>
          )}
        </div>
      </div>

      {activeTab === 'preferences' ? (
        <UserSettingsView
          approvals={approvals}
          setApprovals={setApprovals}
          limits={limits}
          setLimits={setLimits}
          aiWriting={aiWriting}
          setAiWriting={setAiWriting}
          notifications={notifications}
          setNotifications={setNotifications}
        />
      ) : activeTab === 'system' ? (
        <SystemSettingsView data={serverSettings} />
      ) : (
        <div className="space-y-6 max-w-4xl">
          {isCheckoutSuccess && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-sm flex items-center gap-3">
              <Check className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-semibold">Subscription Activated Successfully!</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                  Your 14-day free trial has been provisioned and your plan quotas are now updated.
                </p>
              </div>
            </div>
          )}
          <SubscriptionCard
            subscription={subscription ?? null}
            isLoading={isSubscriptionLoading || isConfirming}
            onRefresh={refetchSubscription}
          />
        </div>
      )}
    </div>
  )
}

/**
 * =========================================================================
 * NEW USER DASHBOARD SETTINGS SCREEN (100% Mockup Design)
 * =========================================================================
 */
function UserSettingsView({
  approvals,
  setApprovals,
  limits,
  setLimits,
  aiWriting,
  setAiWriting,
  notifications,
  setNotifications,
}: {
  approvals: Record<string, ApprovalSetting>
  setApprovals: React.Dispatch<React.SetStateAction<Record<string, ApprovalSetting>>>
  limits: {
    likes: number
    comments: number
    connectionRequests: number
    messages: number
    profileViews: number
    posts: number
    startHour: string
    endHour: string
    timezone: string
    warmupMode: boolean
  }
  setLimits: React.Dispatch<
    React.SetStateAction<{
      likes: number
      comments: number
      connectionRequests: number
      messages: number
      profileViews: number
      posts: number
      startHour: string
      endHour: string
      timezone: string
      warmupMode: boolean
    }>
  >
  aiWriting: {
    aboutYou: string
    neverSay: string
    language: string
  }
  setAiWriting: React.Dispatch<
    React.SetStateAction<{
      aboutYou: string
      neverSay: string
      language: string
    }>
  >
  notifications: {
    browserApproval: boolean
    emailDigest: boolean
    linkedinWarning: boolean
  }
  setNotifications: React.Dispatch<
    React.SetStateAction<{
      browserApproval: boolean
      emailDigest: boolean
      linkedinWarning: boolean
    }>
  >
}) {
  // Warm-up status query (FR-9.4)
  const { data: warmupStatus } = useQuery({
    queryKey: ['warmup-status'],
    queryFn: agentApi.getWarmupStatus,
    enabled: limits.warmupMode,
  })

  const [withdrawStatus, setWithdrawStatus] = useState<string | null>(null)
  const [isWithdrawing, setIsWithdrawing] = useState<boolean>(false)

  const toggleApproval = (key: string, value: ApprovalSetting) => {
    setApprovals((prev) => ({ ...prev, [key]: value }))
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* ================= LEFT COLUMN ================= */}
        <div className="space-y-6">
          {/* Card 1: Human approval */}
          <Card className="p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Human approval
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
                Choose which actions wait for you. Campaigns can override this.
              </p>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-border/60">
              {/* Item 1: Likes */}
              <ApprovalRow
                label="Likes"
                description="Reacting to prospects' posts"
                value={approvals.likes}
                onChange={(val) => toggleApproval('likes', val)}
              />

              {/* Item 2: Profile views & follows */}
              <ApprovalRow
                label="Profile views & follows"
                description="Low-risk warm-up actions"
                value={approvals.profileViews}
                onChange={(val) => toggleApproval('profileViews', val)}
              />

              {/* Item 3: AI comments */}
              <ApprovalRow
                label="AI comments"
                description="Comments on prospects' posts"
                value={approvals.aiComments}
                onChange={(val) => toggleApproval('aiComments', val)}
              />

              {/* Item 4: Connection notes */}
              <ApprovalRow
                label="Connection notes"
                description="Note sent with a connection request"
                value={approvals.connectionNotes}
                onChange={(val) => toggleApproval('connectionNotes', val)}
              />

              {/* Item 5: Messages */}
              <ApprovalRow
                label="Messages"
                description="Follow-ups after they accept"
                value={approvals.messages}
                onChange={(val) => toggleApproval('messages', val)}
              />

              {/* Item 6: Your posts */}
              <ApprovalRow
                label="Your posts"
                description="Content published to your profile"
                value={approvals.yourPosts}
                onChange={(val) => toggleApproval('yourPosts', val)}
              />
            </div>
          </Card>
        </div>

        {/* ================= RIGHT COLUMN ================= */}
        <div className="space-y-6">
          {/* Card 3: Daily safety limits */}
          <Card className="p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Daily safety limits
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-5">
                Actions are spread randomly across working hours and never exceed these caps.
              </p>
            </div>

            <div className="space-y-3.5">
              {/* Likes */}
              <LimitInputRow
                label="Likes"
                value={limits.likes}
                onChange={(val) => setLimits((prev) => ({ ...prev, likes: val }))}
              />

              {/* Comments */}
              <LimitInputRow
                label="Comments"
                value={limits.comments}
                onChange={(val) => setLimits((prev) => ({ ...prev, comments: val }))}
              />

              {/* Connection requests */}
              <LimitInputRow
                label="Connection requests"
                value={limits.connectionRequests}
                onChange={(val) => setLimits((prev) => ({ ...prev, connectionRequests: val }))}
              />

              {/* Messages */}
              <LimitInputRow
                label="Messages"
                value={limits.messages}
                onChange={(val) => setLimits((prev) => ({ ...prev, messages: val }))}
              />

              {/* Profile views */}
              <LimitInputRow
                label="Profile views"
                value={limits.profileViews}
                onChange={(val) => setLimits((prev) => ({ ...prev, profileViews: val }))}
              />

              {/* Posts */}
              <LimitInputRow
                label="Posts"
                value={limits.posts}
                onChange={(val) => setLimits((prev) => ({ ...prev, posts: val }))}
              />

              {/* Working hours */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  Working hours
                </span>
                <div className="flex items-center gap-2">
                  <Input
                    type="text"
                    value={limits.startHour}
                    onChange={(e) =>
                      setLimits((prev) => ({ ...prev, startHour: e.target.value }))
                    }
                    className="w-20 text-center text-xs h-9"
                  />
                  <span className="text-slate-400 text-xs">-</span>
                  <Input
                    type="text"
                    value={limits.endHour}
                    onChange={(e) => setLimits((prev) => ({ ...prev, endHour: e.target.value }))}
                    className="w-20 text-center text-xs h-9"
                  />
                  <select
                    value={limits.timezone}
                    aria-label="Working hours timezone"
                    onChange={(e) =>
                      setLimits((prev) => ({ ...prev, timezone: e.target.value }))
                    }
                    className="rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400 h-9"
                  >
                    <option value="IST (UTC+5:30)">IST (UTC+5:30)</option>
                    <option value="EST (UTC-5:00)">EST (UTC-5:00)</option>
                    <option value="PST (UTC-8:00)">PST (UTC-8:00)</option>
                    <option value="GMT (UTC+0:00)">GMT (UTC+0:00)</option>
                    <option value="CET (UTC+1:00)">CET (UTC+1:00)</option>
                  </select>
                </div>
              </div>

              {/* Warm-up mode checkbox (FR-9.4) */}
              <div className="pt-3 border-t border-slate-100 dark:border-border/60 space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <div>
                    <span className="text-sm font-medium text-slate-900 dark:text-white block">
                      Warm-up mode for new accounts
                    </span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      Ramp daily action limits from 35% to 100% over the first 21 days to protect account reputation.
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={limits.warmupMode}
                    onChange={(e) =>
                      setLimits((prev) => ({ ...prev, warmupMode: e.target.checked }))
                    }
                    className="size-4.5 rounded border-slate-300 text-[#2445C8] focus:ring-[#2445C8] accent-[#2445C8]"
                  />
                </label>
                {limits.warmupMode && warmupStatus && (
                  <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200 flex items-center justify-between">
                    <span>
                      Active Day {warmupStatus.warmup_day} of {warmupStatus.warmup_total_days} · Current multiplier: <strong>{warmupStatus.percentage}%</strong>
                    </span>
                    <Badge variant="outline" className="border-blue-300 text-blue-700 dark:text-blue-300 font-semibold text-[10px]">
                      {warmupStatus.warmup_enabled ? 'Active Ramp' : 'Graduated'}
                    </Badge>
                  </div>
                )}
              </div>

              {/* Stale Invitation Auto-Withdrawal (FR-9.6) */}
              <div className="pt-3 border-t border-slate-100 dark:border-border/60 flex items-center justify-between gap-4">
                <div>
                  <span className="text-sm font-medium text-slate-900 dark:text-white block">
                    Stale invitation withdrawa
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    Automatically cancel connection requests older than 14 days to keep pending queue healthy.
                  </span>
                  {withdrawStatus && (
                    <span className="text-[11px] font-medium text-emerald-600 block mt-1">
                      {withdrawStatus}
                    </span>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  loading={isWithdrawing}
                  onClick={async () => {
                    setIsWithdrawing(true)
                    try {
                      const res = await agentApi.withdrawStaleInvites(14)
                      setWithdrawStatus(res.message)
                      setTimeout(() => setWithdrawStatus(null), 4000)
                    } catch (err: any) {
                      setWithdrawStatus(err?.message || 'Failed to withdraw stale invites.')
                    } finally {
                      setIsWithdrawing(false)
                    }
                  }}
                  className="text-xs h-8 px-3 border-slate-200 dark:border-border shrink-0"
                >
                  Withdraw now
                </Button>
              </div>
            </div>
          </Card>

          {/* Card 4: How the AI writes for you */}
          <Card className="p-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
              How the AI writes for you
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  About you
                </label>
                <Textarea
                  rows={3}
                  value={aiWriting.aboutYou}
                  onChange={(e) =>
                    setAiWriting((prev) => ({ ...prev, aboutYou: e.target.value }))
                  }
                  className="text-xs leading-relaxed"
                  placeholder="Tell the AI about your company, your role, and your value proposition..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Never say or do
                </label>
                <Input
                  type="text"
                  value={aiWriting.neverSay}
                  onChange={(e) =>
                    setAiWriting((prev) => ({ ...prev, neverSay: e.target.value }))
                  }
                  className="text-xs h-9"
                  placeholder="e.g. Pitch services in comments, use emojis, mention pricing"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Language
                </label>
                <select
                  value={aiWriting.language}
                  aria-label="Language"
                  onChange={(e) =>
                    setAiWriting((prev) => ({ ...prev, language: e.target.value }))
                  }
                  className="w-full rounded-md border border-slate-200 dark:border-border bg-white dark:bg-card px-3 py-2 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="English (match the post's language)">
                    English (match the post's language)
                  </option>
                  <option value="English (US)">English (US)</option>
                  <option value="English (UK)">English (UK)</option>
                  <option value="French">French</option>
                  <option value="German">German</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </div>
            </div>
          </Card>

          {/* Card 5: Notifications */}
          <Card className="p-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
              Notifications
            </h2>

            <div className="space-y-3.5">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  Browser notification when something needs approval
                </span>
                <input
                  type="checkbox"
                  checked={notifications.browserApproval}
                  onChange={(e) =>
                    setNotifications((prev) => ({
                      ...prev,
                      browserApproval: e.target.checked,
                    }))
                  }
                  className="size-4.5 rounded border-slate-300 text-[#2445C8] focus:ring-[#2445C8] accent-[#2445C8]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  Daily email digest at 08:00
                </span>
                <input
                  type="checkbox"
                  checked={notifications.emailDigest}
                  onChange={(e) =>
                    setNotifications((prev) => ({ ...prev, emailDigest: e.target.checked }))
                  }
                  className="size-4.5 rounded border-slate-300 text-[#2445C8] focus:ring-[#2445C8] accent-[#2445C8]"
                />
              </label>

              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  Alert me if LinkedIn shows a warning
                </span>
                <input
                  type="checkbox"
                  checked={notifications.linkedinWarning}
                  onChange={(e) =>
                    setNotifications((prev) => ({
                      ...prev,
                      linkedinWarning: e.target.checked,
                    }))
                  }
                  className="size-4.5 rounded border-slate-300 text-[#2445C8] focus:ring-[#2445C8] accent-[#2445C8]"
                />
              </label>
            </div>
          </Card>

          {/* Card 6: Danger Zone (Onboarding Replay) */}
          <DangerZone />
        </div>
      </div>
  )
}

/**
 * Segmented approval toggle row matching the mockup
 */
function ApprovalRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: ApprovalSetting
  onChange: (val: ApprovalSetting) => void
}) {
  return (
    <div className="flex items-center justify-between py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 pr-4">
        <p className="text-sm font-semibold text-slate-900 dark:text-white">{label}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>

      {/* Segmented Pill */}
      <div className="inline-flex rounded-md border border-slate-200 dark:border-border p-0.5 bg-slate-100/60 dark:bg-muted shrink-0">
        <button
          type="button"
          onClick={() => onChange('AUTOMATIC')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            value === 'AUTOMATIC'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-medium shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Automatic
        </button>
        <button
          type="button"
          onClick={() => onChange('MANUAL')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            value === 'MANUAL'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 font-medium shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          Needs approval
        </button>
      </div>
    </div>
  )
}

/**
 * Daily Limit input row with trailing "per day"
 */
function LimitInputRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (val: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium text-slate-900 dark:text-white">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
          className="w-20 text-center font-medium text-xs h-9"
        />
        <span className="text-xs text-slate-500 dark:text-slate-400 w-12 text-left">
          per day
        </span>
      </div>
    </div>
  )
}



/**
 * =========================================================================
 * ORIGINAL SYSTEM SETTINGS (Preserved in full for system & AI diagnostics)
 * =========================================================================
 */
function SystemSettingsView({ data }: { data: AppSettings }) {
  return (
    <div className="space-y-6">
      <Card
        title="AI provider"
        action={
          data.dry_run ? <Badge tone="caution">DRY RUN</Badge> : <Badge tone="positive">LIVE</Badge>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Provider" value={data.llm.provider} />
          <Detail label="Model" value={data.llm.model} />
          <Detail label="Environment" value={data.app_env} />
          <Detail
            label="Max context"
            value={`${data.llm.max_context_tokens.toLocaleString()} tokens`}
          />
          <Detail label="Platform adapter" value={data.platform} />
          <Detail label="Connection delay" value={`${data.connection_delay_hours} hours`} />
        </dl>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
            Model capabilities
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Capability label="Structured output" enabled={data.llm.supports_structured_output} />
            <Capability label="Tool calling" enabled={data.llm.supports_tool_calling} />
            <Capability label="Streaming" enabled={data.llm.supports_streaming} />
            <Capability label="Vision" enabled={data.llm.supports_vision} />
          </div>
        </div>

        {/* <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
          Switch providers with <code className="text-slate-700 dark:text-slate-300">LLM_PROVIDER</code> in the active
          env file — <code className="text-slate-700 dark:text-slate-300">claude</code>,{' '}
          <code className="text-slate-700 dark:text-slate-300">local</code> or <code className="text-slate-700 dark:text-slate-300">mock</code>.
          No application code changes.
        </p> */}
      </Card>

      <Card title="Platform capabilities">
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          What the configured adapter can actually do. Unsupported operations are recorded as
          skipped steps rather than worked around.
        </p>
        <ul className="divide-y divide-slate-100 dark:divide-border/60">
          {data.platform_capabilities.map((capability) => (
            <li key={capability.capability} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {humanize(capability.capability)}
                </span>
                <Badge
                  tone={
                    SUPPORT_TONES[capability.support as keyof typeof SUPPORT_TONES] ?? 'neutral'
                  }
                >
                  {capability.support.replace(/_/g, ' ')}
                </Badge>
              </div>
              {capability.note && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{capability.note}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Agent prompts">
        <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
          Prompts live as versioned Markdown under{' '}
          <code className="text-slate-800 dark:text-slate-200">backend/app/ai/prompts/</code>. Editing a file changes agent
          behaviour without touching Python.
        </p>
        <ul className="divide-y divide-slate-100 dark:divide-border/60">
          {data.prompts.map((prompt) => (
            <li key={prompt.agent_name} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {humanize(prompt.agent_name)}
                </span>
                <Badge tone="accent">{prompt.version}</Badge>
                {prompt.system_prompt_exists && prompt.user_prompt_exists ? (
                  <Badge tone="positive">Loaded</Badge>
                ) : (
                  <Badge tone="critical">Missing file</Badge>
                )}
              </div>
              {prompt.common_includes.length > 0 && (
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Composed with: {prompt.common_includes.join(', ')}
                </p>
              )}
              <div className="mt-2">
                <p className="mb-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Runtime variables
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {prompt.user_variables.length ? (
                    prompt.user_variables.map((val) => (
                      <Badge key={val} tone="neutral">
                        {val}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400">None</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Rate limits">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data.limits).map(([key, value]) => (
            <Detail key={key} label={humanize(key)} value={String(value)} />
          ))}
        </dl>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          These are the server defaults. Each campaign carries its own limits, editable on the
          campaign page.
        </p>
      </Card>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{value}</dd>
    </div>
  )
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <Badge tone={enabled ? 'positive' : 'neutral'}>{enabled ? `${label} ✓` : label}</Badge>
}
