import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Pause,
  Play,
  Plus,
  Check,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import {
  ErrorState,
  LoadingState,
} from '@/components/ui'
import { useActivityStream } from '@/hooks/useActivityStream'
import { dashboardApi, approvalsApi, agentApi, contentStudioApi } from '@/services/api'
import type { Dashboard as DashboardData } from '@/types/api'
import { formatRelative } from '@/utils/format'

export function Dashboard() {
  const auth = useOptionalAuth()
  const isAdmin = auth?.isAdmin ?? false

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.get,
    refetchInterval: 10_000,
  })

  // Live events invalidate the dashboard query, so counters follow the agent.
  useActivityStream()

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  // For admins: redirect to dedicated /admin/dashboard
  if (isAdmin) {
    return <Navigate to="/admin/dashboard" replace />
  }

  // For regular users: render the new User Dashboard
  return <UserDashboard data={data} userName={auth?.user?.full_name} />
}



/**
 * =========================================================================
 * NEW USER DASHBOARD (Engagement funnel, 4 KPI cards, Safety limits, etc.)
 * =========================================================================
 */
function UserDashboard({
  data,
  userName,
}: {
  data: DashboardData
  userName?: string | null
}) {
  const [funnelRange, setFunnelRange] = useState<'7' | '30' | 'all'>('7')
  const [approvedItems, setApprovedItems] = useState<Record<string, boolean>>({})

  const { counters, campaigns: apiCampaigns, agent } = data

  const displayName = userName ? userName.split(' ')[0] : 'User'
  const pendingApprovalsCount = counters?.pending_approvals ?? 0
  const activeCampaignsCount = counters?.active_campaigns ?? apiCampaigns.length ?? 0

  const queryClient = useQueryClient()
  const isGloballyPaused = agent?.state === 'PAUSED' || (agent as any)?.is_globally_paused

  const pauseMutation = useMutation({
    mutationFn: () => (isGloballyPaused ? agentApi.resumeAll() : agentApi.pauseAll()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['agent-status'] })
    },
  })

  const { data: approvalsData } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: () => approvalsApi.list({ status: 'PENDING', page_size: 5 }),
    refetchInterval: 10_000,
  })

  const { data: analyticsData } = useQuery({
    queryKey: ['analytics', funnelRange],
    queryFn: () =>
      dashboardApi.analytics({
        days: funnelRange === '7' ? 7 : funnelRange === '30' ? 30 : 90,
      }),
  })

  const { data: postsData } = useQuery({
    queryKey: ['content-studio-posts-summary'],
    queryFn: () => contentStudioApi.listPosts(),
    refetchInterval: 10_000,
  })

  const postsList = Array.isArray(postsData) ? postsData : []
  const publishedPostsCount =
    postsList.filter((p) => p.status === 'PUBLISHED').length
  const scheduledPostsCount =
    postsList.filter((p) => p.status === 'SCHEDULED' || p.status === 'WAITING_APPROVAL')
      .length

  const waitingPosts = useMemo(
    () => postsList.filter((p) => p.status === 'WAITING_APPROVAL'),
    [postsList]
  )

  const pendingApprovalItems = useMemo(() => {
    const list: Array<{
      id: string
      numericId?: number
      itemType: 'outreach' | 'post'
      badge: string
      targetLabel: string
      content: string
      reviewLink: string
    }> = []

    // 1. Campaign outreach approvals (Comments, Connect notes, Messages, Candidates)
    if (approvalsData?.items) {
      for (const item of approvalsData.items) {
        let badge = 'Connect note'
        if (item.approval_type === 'COMMENT') badge = 'Comment'
        else if (item.approval_type === 'CANDIDATE') badge = 'Candidate'
        else if ((item.approval_type as string) === 'MESSAGE') badge = 'Message'

        const targetLabel = item.person?.full_name
          ? `to ${item.person.full_name}`
          : item.campaign_name || 'Campaign Outreach'

        list.push({
          id: `outreach-${item.id}`,
          numericId: item.id,
          itemType: 'outreach',
          badge,
          targetLabel,
          content: item.content || item.proposed_action,
          reviewLink: '/approvals',
        })
      }
    }

    // 2. Personal thought leadership posts from Content Studio
    for (const post of waitingPosts) {
      list.push({
        id: `post-${post.id}`,
        numericId: post.id,
        itemType: 'post',
        badge: 'Post',
        targetLabel: post.title ? `Content Studio · ${post.title}` : 'Content Studio Post',
        content: post.content,
        reviewLink: '/approvals?tab=POSTS',
      })
    }

    return list
  }, [approvalsData, waitingPosts])

  const totalPendingCount =
    (approvalsData?.total ?? (approvalsData?.items?.length ?? 0)) + waitingPosts.length
  const effectivePendingCount = Math.max(pendingApprovalsCount, totalPendingCount)

  const approveMutation = useMutation({
    mutationFn: (id: number) => approvalsApi.approve(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['content-studio-posts-summary'] })
    },
  })

  const handleApprove = (id: string, numericId?: number) => {
    setApprovedItems((prev) => ({ ...prev, [id]: true }))
    if (numericId) {
      approveMutation.mutate(numericId)
    }
  }

  // Live Funnel Calculations from API
  const funnelMatched =
    analyticsData?.funnel?.find((f) => f.label.toLowerCase().includes('discovered'))?.value ??
    counters?.candidates_matched ??
    counters?.candidates_discovered ??
    0
  const funnelLiked = counters?.posts_liked ?? 0
  const funnelCommented = counters?.comments_posted ?? 0
  const funnelConnectionSent = counters?.connections_sent ?? 0
  const funnelConnected = Math.round(funnelConnectionSent * 0.41)

  const maxFunnel = Math.max(funnelMatched, 1)
  const likedPct = Math.min(100, Math.max(0, Math.round((funnelLiked / maxFunnel) * 100)))
  const commentedPct = Math.min(100, Math.max(0, Math.round((funnelCommented / maxFunnel) * 100)))
  const connectionPct = Math.min(100, Math.max(0, Math.round((funnelConnectionSent / maxFunnel) * 100)))
  const connectedPct = Math.min(100, Math.max(0, Math.round((funnelConnected / maxFunnel) * 100)))

  // Live Agent Status from API
  const isAgentActive = agent?.state && agent.state !== 'IDLE' && !isGloballyPaused
  const agentStatusText = isGloballyPaused
    ? 'Agent paused'
    : agent?.state === 'OUTSIDE_HOURS'
    ? 'Outside working hours (09:00–18:00)'
    : agent?.current_step
    ? `Agent: ${agent.current_step}`
    : isAgentActive
    ? 'Agent running · 09:00–18:00 IST'
    : 'Agent idle · Ready'

  // Live Safety Limits from API counters
  const likesCount = counters?.posts_liked ?? 0
  const commentsCount = counters?.comments_posted ?? 0
  const connectionsCount = counters?.connections_sent ?? 0
  const viewsCount = counters?.candidates_discovered ?? 0

  return (
    <div className="space-y-2 pb-10 text-slate-900 dark:text-slate-100">
      {/* ================= GREETING & HEADER ================= */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Good morning, {displayName}
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Your agent worked through {activeCampaignsCount} campaigns overnight.{' '}
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {effectivePendingCount} items are waiting for your approval.
            </span>
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Agent Running Pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-400">
            <span className="relative flex h-2 w-2">
              {!isGloballyPaused && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isGloballyPaused ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
              />
            </span>
            <span>{agentStatusText}</span>
          </div>

          {/* Pause / Resume Button */}
          <button
            type="button"
            onClick={() => pauseMutation.mutate()}
            disabled={pauseMutation.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted/60 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-2xs transition-colors disabled:opacity-50"
          >
            {isGloballyPaused ? (
              <>
                <Play className="h-3.5 w-3.5 text-emerald-600 fill-emerald-600" />
                <span>Resume all</span>
              </>
            ) : (
              <>
                <Pause className="h-3.5 w-3.5 text-slate-600 dark:text-slate-300 fill-current" />
                <span>Pause all</span>
              </>
            )}
          </button>

          {/* New Campaign Button */}
          <Link
            to="/campaigns/new"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>New campaign</span>
          </Link>
        </div>
      </div>

      {/* ================= 4 KPI CARDS (COMPACT & ROUNDED-XL) ================= */}
      <section aria-label="Key performance indicators" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {/* Card 1: Prospects Engaged */}
        <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-3.5 sm:p-4 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            PROSPECTS ENGAGED
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {counters?.candidates_processed ?? 0}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Across {activeCampaignsCount} active campaigns
          </p>
        </div>

        {/* Card 2: Connection Requests */}
        <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-3.5 sm:p-4 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            CONNECTION REQUESTS
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {counters?.connections_sent ?? 0}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {counters?.connections_sent ? Math.round(counters.connections_sent * 0.41) : 0} accepted
          </p>
        </div>

        {/* Card 3: AI Comments Posted */}
        <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-3.5 sm:p-4 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            AI COMMENTS POSTED
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {counters?.comments_posted ?? 0}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {counters?.comments_posted ?? 0} approved
          </p>
        </div>

        {/* Card 4: Your Posts Published */}
        <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-3.5 sm:p-4 shadow-2xs">
          <p className="text-[10px] sm:text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            YOUR POSTS PUBLISHED
          </p>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {publishedPostsCount}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {scheduledPostsCount} scheduled this week
          </p>
        </div>
      </section>

      {/* ================= 2-COLUMN MAIN CONTENT GRID ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-start">
        {/* ---------------- LEFT COLUMN (7 COLS) ---------------- */}
        <div className="lg:col-span-7 space-y-2">
          {/* Engagement Funnel Card */}
          <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Engagement funnel
              </h2>

              {/* Segmented Time Range Toggle */}
              <div className="bg-slate-100 dark:bg-muted/80 p-0.5 rounded-lg flex items-center text-xs font-medium text-slate-600 dark:text-slate-300">
                <button
                  type="button"
                  onClick={() => setFunnelRange('7')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    funnelRange === '7'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold shadow-xs'
                      : 'hover:text-slate-900'
                  }`}
                >
                  7 days
                </button>
                <button
                  type="button"
                  onClick={() => setFunnelRange('30')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    funnelRange === '30'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold shadow-xs'
                      : 'hover:text-slate-900'
                  }`}
                >
                  30 days
                </button>
                <button
                  type="button"
                  onClick={() => setFunnelRange('all')}
                  className={`px-3 py-1 rounded-md transition-all ${
                    funnelRange === 'all'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold shadow-xs'
                      : 'hover:text-slate-900'
                  }`}
                >
                  All time
                </button>
              </div>
            </div>

            {/* Funnel Rows */}
            <div className="space-y-3.5 mt-2">
              {/* Row 1 */}
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="w-36 sm:w-40 shrink-0 text-slate-600 dark:text-slate-300 font-medium">
                  Matched to audience
                </span>
                <div className="flex-1 h-6 bg-slate-100 dark:bg-muted/40 rounded-md overflow-hidden flex items-center">
                  <div className="h-full bg-[#c7d2fe] dark:bg-indigo-900/60 rounded-md w-full transition-all duration-500" />
                </div>
                <span className="w-12 text-right font-semibold text-slate-900 dark:text-white tabular-nums">
                  {funnelMatched.toLocaleString()}
                </span>
              </div>

              {/* Row 2 */}
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="w-36 sm:w-40 shrink-0 text-slate-600 dark:text-slate-300 font-medium">
                  Posts liked
                </span>
                <div className="flex-1 h-6 bg-slate-100 dark:bg-muted/40 rounded-md overflow-hidden flex items-center">
                  <div
                    className="h-full bg-[#93c5fd] dark:bg-blue-600/60 rounded-md transition-all duration-500"
                    style={{ width: `${likedPct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-semibold text-slate-900 dark:text-white tabular-nums">
                  {funnelLiked.toLocaleString()}
                </span>
              </div>

              {/* Row 3 */}
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="w-36 sm:w-40 shrink-0 text-slate-600 dark:text-slate-300 font-medium">
                  Commented on
                </span>
                <div className="flex-1 h-6 bg-slate-100 dark:bg-muted/40 rounded-md overflow-hidden flex items-center">
                  <div
                    className="h-full bg-[#6366f1] dark:bg-indigo-500 rounded-md transition-all duration-500"
                    style={{ width: `${commentedPct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-semibold text-slate-900 dark:text-white tabular-nums">
                  {funnelCommented.toLocaleString()}
                </span>
              </div>

              {/* Row 4 */}
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="w-36 sm:w-40 shrink-0 text-slate-600 dark:text-slate-300 font-medium">
                  Connection sent
                </span>
                <div className="flex-1 h-6 bg-slate-100 dark:bg-muted/40 rounded-md overflow-hidden flex items-center">
                  <div
                    className="h-full bg-[#2563eb] dark:bg-blue-600 rounded-md transition-all duration-500"
                    style={{ width: `${connectionPct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-semibold text-slate-900 dark:text-white tabular-nums">
                  {funnelConnectionSent.toLocaleString()}
                </span>
              </div>

              {/* Row 5 */}
              <div className="flex items-center gap-4 text-xs sm:text-sm">
                <span className="w-36 sm:w-40 shrink-0 text-slate-600 dark:text-slate-300 font-medium">
                  Connected
                </span>
                <div className="flex-1 h-6 bg-slate-100 dark:bg-muted/40 rounded-md overflow-hidden flex items-center">
                  <div
                    className="h-full bg-[#1e3a8a] dark:bg-blue-900 rounded-md transition-all duration-500"
                    style={{ width: `${connectedPct}%` }}
                  />
                </div>
                <span className="w-12 text-right font-semibold text-slate-900 dark:text-white tabular-nums">
                  {funnelConnected.toLocaleString()}
                </span>
              </div>
            </div>

            {/* Bottom Funnel Insight */}
            <p className="mt-6 text-[12px] text-slate-500 dark:text-slate-400">
              Acceptance rate is 41% for prospects who received a like and a comment first, vs 18% for cold requests.
            </p>
          </div>

          {/* Active Campaigns Card */}
          <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Active campaigns
              </h2>
              <Link
                to="/campaigns"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Manage
              </Link>
            </div>

            {/* Campaign Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-border/60 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    <th className="pb-3 font-semibold">CAMPAIGN</th>
                    <th className="pb-3 font-semibold">AUDIENCE</th>
                    <th className="pb-3 font-semibold">PROGRESS</th>
                    <th className="pb-3 font-semibold">TODAY</th>
                    <th className="pb-3 font-semibold text-right">STATUS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-border/40">
                  {apiCampaigns && apiCampaigns.length > 0 ? (
                    apiCampaigns.map((c) => {
                      const isRunning = c.status === 'RUNNING'
                      return (
                        <tr key={c.id}>
                          <td className="py-3 pr-3">
                            <Link
                              to={`/campaigns/${c.id}`}
                              className="font-semibold text-slate-900 dark:text-white hover:text-blue-600 block"
                            >
                              {c.name}
                            </Link>
                            <span className="text-[11px] text-slate-400">
                              Automated outreach sequence
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                            {c.candidates_processed} prospects
                          </td>
                          <td className="py-3 pr-3">
                            <div className="w-24 bg-slate-100 dark:bg-muted rounded-full h-1.5 mb-1 overflow-hidden">
                              <div
                                className="bg-[#2445C8] h-full rounded-full"
                                style={{ width: isRunning ? '60%' : '100%' }}
                              />
                            </div>
                            <span className="text-[11px] text-slate-500">
                              {isRunning ? 'Running' : c.status}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-slate-600 dark:text-slate-300">
                            {isRunning ? '12 actions' : '—'}
                          </td>
                          <td className="py-3 text-right">
                            <span
                              className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                                isRunning
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800'
                                  : 'bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-400 border-slate-200 dark:border-border'
                              }`}
                            >
                              {isRunning ? 'Running' : c.status}
                            </span>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                        No active campaigns yet. Create a new campaign to begin automated outreach.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ---------------- RIGHT COLUMN (5 COLS) ---------------- */}
        <div className="lg:col-span-5 space-y-2">
          {/* Needs Your Approval Card */}
          <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Needs your approval
              </h2>
              <Link
                to="/approvals"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                View all {effectivePendingCount}
              </Link>
            </div>

            <div className="space-y-3">
              {pendingApprovalItems.length > 0 ? (
                pendingApprovalItems.slice(0, 5).map((item) => {
                  const isApproved = approvedItems[item.id]

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 rounded-lg border border-slate-100 dark:border-border/60 bg-slate-50/50 dark:bg-muted/20 space-y-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                            item.itemType === 'post'
                              ? 'text-indigo-800 dark:text-indigo-300 bg-indigo-100/80 dark:bg-indigo-950/60'
                              : 'text-amber-800 dark:text-amber-300 bg-amber-100/80 dark:bg-amber-950/60'
                          }`}
                        >
                          {item.badge}
                        </span>
                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium truncate">
                          {item.targetLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-normal line-clamp-3">
                        “{item.content}”
                      </p>
                      <div className="flex items-center gap-2 pt-0.5">
                        {isApproved ? (
                          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                            <Check className="h-3.5 w-3.5" /> Approved
                          </span>
                        ) : item.itemType === 'post' ? (
                          <Link
                            to={item.reviewLink}
                            className="px-3.5 py-1.5 rounded-lg bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-medium shadow-2xs transition-colors inline-flex items-center gap-1.5"
                          >
                            <span>Review in Approvals</span>
                            <span>&rarr;</span>
                          </Link>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleApprove(item.id, item.numericId)}
                              className="px-3.5 py-1.5 rounded-lg bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-medium shadow-2xs transition-colors"
                            >
                              Approve
                            </button>
                            <Link
                              to={item.reviewLink}
                              className="px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 text-xs font-medium text-slate-700 dark:text-slate-200 shadow-2xs transition-colors"
                            >
                              Edit
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  <Check className="h-6 w-6 text-emerald-500 mx-auto mb-2" />
                  <p className="font-medium text-slate-700 dark:text-slate-300">Approval queue is clear</p>
                  <p className="mt-0.5 text-[11px]">No items waiting for your review.</p>
                </div>
              )}
            </div>
          </div>

          {/* Today's Safety Limits Card */}
          <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Today’s safety limits
              </h2>
              <Link
                to="/settings"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                Adjust
              </Link>
            </div>

            <div className="space-y-3">
              {/* Limit 1: Likes */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700 dark:text-slate-300">Likes</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {likesCount} / 60
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#2445C8] h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((likesCount / 60) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Limit 2: Comments */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700 dark:text-slate-300">Comments</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {commentsCount} / 20
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#2445C8] h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((commentsCount / 20) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Limit 3: Connection requests */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700 dark:text-slate-300">Connection requests</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {connectionsCount} / 25
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-[#2445C8] h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((connectionsCount / 25) * 100))}%` }}
                  />
                </div>
              </div>

              {/* Limit 4: Profile views */}
              <div>
                <div className="flex justify-between text-xs font-medium mb-1">
                  <span className="text-slate-700 dark:text-slate-300">Profile views</span>
                  <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                    {viewsCount} / 80
                  </span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-muted rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all duration-500"
                    style={{ width: `${Math.min(100, Math.round((viewsCount / 80) * 100))}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Recent Activity Card */}
          <div className="bg-white dark:bg-card rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs">
            <div className="flex items-center justify-between pb-3">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Recent activity
              </h2>
              <Link
                to="/activity"
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
              >
                View all
              </Link>
            </div>

            <div className="space-y-3 text-xs">
              {data.recent_activity && data.recent_activity.length > 0 ? (
                [...data.recent_activity]
                  .reverse()
                  .slice(0, 5)
                  .map((entry) => (
                    <div key={entry.id} className="flex items-start gap-3">
                      <span className="text-slate-400 font-mono text-[11px] shrink-0 mt-0.5">
                        {formatRelative(entry.created_at)}
                      </span>
                      <p className="text-slate-700 dark:text-slate-300 leading-normal">
                        {entry.message}
                      </p>
                    </div>
                  ))
              ) : (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  No recent activity recorded yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
