import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Zap,
  Cpu,
  DollarSign,
  Gauge,
  Flame,
  AlertTriangle,
  Timer,
  Server,
  Filter,
  Calendar,
  RefreshCw,
  TrendingUp,
  BarChart3,
  Sparkles,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { campaignsApi, dashboardApi } from '@/services/api'
import { formatDate } from '@/utils/format'

const SERIES_COLORS = {
  likes: '#2445C8',
  comments: '#7c3aed',
  connections: '#10b981',
  failures: '#ef4444',
}

const AXIS_STYLE = { fontSize: 11, fill: '#64748b' }

interface TooltipPayloadItem {
  name: string
  value: number | string
  color?: string
  fill?: string
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}) {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 px-3 py-2 shadow-md backdrop-blur-xs text-xs z-50">
        {label && <p className="font-semibold text-slate-800 dark:text-slate-100 mb-1.5">{label}</p>}
        <div className="space-y-1">
          {payload.map((entry, index) => (
            <div key={`item-${index}`} className="flex items-center justify-between gap-3 text-slate-600 dark:text-slate-300">
              <span className="flex items-center gap-1.5 capitalize text-[11px]">
                <span
                  className="size-2 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color || entry.fill || '#2445C8' }}
                />
                {entry.name || 'Count'}:
              </span>
              <span className="font-bold text-slate-900 dark:text-slate-100 tabular-nums text-xs">
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return null
}

export function Analytics() {
  const auth = useOptionalAuth()
  if (auth?.isAdmin) {
    return <Navigate to="/admin/analytics" replace />
  }

  const [days, setDays] = useState<number>(14)
  const [campaignId, setCampaignId] = useState<number | undefined>(undefined)

  // Fetch Analytics data
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['analytics', { days, campaign_id: campaignId }],
    queryFn: () => dashboardApi.analytics({ days, campaign_id: campaignId }),
    refetchInterval: 60_000,
  })

  // Fetch Campaigns for optional filtering
  const campaignsQuery = useQuery({
    queryKey: ['campaigns-filter-list'],
    queryFn: () => campaignsApi.list({ page_size: 100 }),
  })

  const hasActivity = useMemo(() => {
    if (!data?.time_series) return false
    return data.time_series.some((point) => point.likes + point.comments + point.connections > 0)
  }, [data?.time_series])

  // Conversion funnel calculations
  const funnelStats = useMemo(() => {
    if (!data?.funnel) return null
    const getVal = (key: string) =>
      data.funnel.find((f) => f.label.toLowerCase().includes(key))?.value ?? 0

    const discovered = getVal('discovered')
    const acceptedCand = getVal('candidates accepted')
    const analyzedPosts = getVal('posts analyzed')
    const acceptedPosts = getVal('posts accepted')

    const candAcceptRate = discovered > 0 ? Math.round((acceptedCand / discovered) * 100) : 0
    const postAcceptRate = analyzedPosts > 0 ? Math.round((acceptedPosts / analyzedPosts) * 100) : 0

    return { discovered, acceptedCand, analyzedPosts, acceptedPosts, candAcceptRate, postAcceptRate }
  }, [data?.funnel])

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  const providerSummary =
    Object.entries(data.ai.by_provider)
      .map(([p, count]) => `${p}: ${count}`)
      .join(' · ') || 'None'

  return (
    <div className="space-y-4 pb-12 text-slate-900 dark:text-slate-100">
      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Analytics
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Only what the system actually recorded. Nothing is inferred about what happened after an action left the app.
          </p>
        </div>

        {/* Filter Controls & Refresh */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Campaign Selector */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-card border border-slate-200 dark:border-border rounded-lg px-2.5 py-1 shadow-2xs text-xs">
            <Filter className="size-3.5 text-slate-400" />
            <select
              value={campaignId ?? 'all'}
              onChange={(e) => setCampaignId(e.target.value === 'all' ? undefined : Number(e.target.value))}
              aria-label="Filter by campaign"
              className="bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value="all">All Campaigns</option>
              {campaignsQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Timeframe Selector */}
          <div className="flex items-center gap-1.5 bg-white dark:bg-card border border-slate-200 dark:border-border rounded-lg px-2.5 py-1 shadow-2xs text-xs">
            <Calendar className="size-3.5 text-slate-400" />
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              aria-label="Select timeframe"
              className="bg-transparent text-xs text-slate-700 dark:text-slate-200 focus:outline-none cursor-pointer"
            >
              <option value={7}>Last 7 days</option>
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
            </select>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-8.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* ================= COMPACT 8-METRIC AI & SYSTEM KPI GRID ================= */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {/* Metric 1: AI Requests Today */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">AI Requests Today</span>
            <div className="size-6 rounded-md bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
              <Zap className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              {data.ai.requests_today}
            </span>
            <span className="text-[11px] text-slate-400 truncate">
              of {data.ai.requests_total} total
            </span>
          </div>
        </Card>

        {/* Metric 2: AI Requests Total */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total AI Calls</span>
            <div className="size-6 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#2445C8]">
              <Cpu className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              {data.ai.requests_total}
            </span>
            <span className="text-[11px] text-slate-400 truncate">all-time requests</span>
          </div>
        </Card>

        {/* Metric 3: Estimated Cost */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Estimated Cost</span>
            <div className="size-6 rounded-md bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <DollarSign className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              ${data.ai.estimated_cost_usd.toFixed(4)}
            </span>
            <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 truncate">
              Local: $0.00
            </span>
          </div>
        </Card>

        {/* Metric 4: Average Latency */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Average Latency</span>
            <div className="size-6 rounded-md bg-cyan-50 dark:bg-cyan-950/50 flex items-center justify-center text-cyan-600">
              <Gauge className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              {data.ai.average_latency_ms} ms
            </span>
            <span className="text-[11px] text-slate-400 truncate">per completion</span>
          </div>
        </Card>

        {/* Metric 5: GPU Compute */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">GPU Seconds</span>
            <div className="size-6 rounded-md bg-orange-50 dark:bg-orange-950/50 flex items-center justify-center text-orange-600">
              <Flame className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              {data.ai.gpu_seconds.toFixed(1)}s
            </span>
            <span className="text-[11px] text-slate-400 truncate">compute usage</span>
          </div>
        </Card>

        {/* Metric 6: AI Failure Rate */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">AI Failure Rate</span>
            <div
              className={`size-6 rounded-md flex items-center justify-center ${
                data.ai.failure_rate > 0
                  ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50'
                  : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50'
              }`}
            >
              <AlertTriangle className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className={`text-lg sm:text-xl font-bold tabular-nums ${
                data.ai.failure_rate > 0 ? 'text-rose-600' : 'text-slate-900 dark:text-white'
              }`}
            >
              {(data.ai.failure_rate * 100).toFixed(1)}%
            </span>
            <span className="text-[11px] text-slate-400 truncate">
              {data.ai.failure_rate === 0 ? 'Zero errors' : 'Requires review'}
            </span>
          </div>
        </Card>

        {/* Metric 7: Average Processing */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Avg Processing</span>
            <div className="size-6 rounded-md bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600">
              <Timer className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">
              {data.average_processing_seconds === null
                ? '—'
                : `${Math.round(data.average_processing_seconds)}s`}
            </span>
            <span className="text-[11px] text-slate-400 truncate">end-to-end</span>
          </div>
        </Card>

        {/* Metric 8: Provider Breakdown */}
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Provider Calls</span>
            <div className="size-6 rounded-md bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center text-violet-600">
              <Server className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
              {providerSummary}
            </span>
          </div>
        </Card>
      </div>

      {/* ================= CHARTS SECTION: 2-COLUMN BALANCED GRID ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ================= CARD 1: CONVERSION FUNNEL ================= */}
        <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#2445C8] flex items-center justify-center">
                <BarChart3 className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Conversion Funnel
                </h3>
                <p className="text-[11px] text-slate-400">
                  Progression from prospect discovery to accepted engagement
                </p>
              </div>
            </div>

            {/* Quick Conversion Yield Chips */}
            {funnelStats && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-[#2445C8] dark:bg-blue-950/50 dark:text-blue-300 border border-blue-100 dark:border-blue-900">
                  Candidate Yield: {funnelStats.candAcceptRate}%
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-100 dark:border-purple-900">
                  Post Acceptance: {funnelStats.postAcceptRate}%
                </span>
              </div>
            )}
          </div>

          {data.funnel.every((point) => point.value === 0) ? (
            <div className="py-12">
              <EmptyState
                title="No funnel data yet"
                description="Start a campaign to evaluate candidates and populate conversion metrics."
                action={
                  <Link to="/campaigns/new">
                    <Button size="sm" className="mt-2 bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs">
                      Create Campaign
                    </Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.funnel}
                  layout="vertical"
                  margin={{ left: 15, right: 20, top: 5, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} opacity={0.6} />
                  <XAxis type="number" tick={AXIS_STYLE} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    tick={{ ...AXIS_STYLE, fill: '#475569' }}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }} />
                  <Bar
                    dataKey="value"
                    name="Count"
                    fill={SERIES_COLORS.likes}
                    radius={[0, 4, 4, 0]}
                    barSize={18}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* ================= CARD 2: ACTIONS TIMELINE ================= */}
        <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-md bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 flex items-center justify-center">
                <TrendingUp className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Actions Over Time
                </h3>
                <p className="text-[11px] text-slate-400">
                  Recorded outreach activities across the last {days} days
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <Link to="/scheduled-actions">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-[#2445C8] hover:underline">
                  Scheduled Queue →
                </Button>
              </Link>
            </div>
          </div>

          {!hasActivity ? (
            <div className="py-10 text-center flex flex-col items-center justify-center space-y-2">
              <div className="size-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
                <TrendingUp className="size-5" />
              </div>
              <h4 className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200">
                No outreach actions in this window
              </h4>
              <p className="text-xs text-slate-400 max-w-xs">
                As the agent likes, comments, and sends connection invites, activity trends will chart here.
              </p>
              <Link to="/activity" className="pt-1">
                <Button variant="outline" size="sm" className="text-xs h-7.5">
                  View Real-Time Activity
                </Button>
              </Link>
            </div>
          ) : (
            <div className="h-60 w-full pt-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.time_series.map((point) => ({
                    ...point,
                    label: formatDate(point.day),
                  }))}
                  margin={{ left: 0, right: 15, top: 10, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" opacity={0.6} />
                  <XAxis dataKey="label" tick={AXIS_STYLE} />
                  <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 11, paddingTop: 6 }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Line
                    type="monotone"
                    dataKey="likes"
                    name="Likes"
                    stroke={SERIES_COLORS.likes}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="comments"
                    name="Comments"
                    stroke={SERIES_COLORS.comments}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="connections"
                    name="Connections"
                    stroke={SERIES_COLORS.connections}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="failures"
                    name="Failures"
                    stroke={SERIES_COLORS.failures}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* ================= OPTIONAL SECTION: COMMON TOPICS IN POSTS ================= */}
      {data.top_topics.length > 0 && (
        <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="size-7 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-600 flex items-center justify-center">
                <Sparkles className="size-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Most Common Topics in Accepted Posts
                </h3>
                <p className="text-[11px] text-slate-400">
                  Recurring themes and subjects in candidate posts approved for engagement
                </p>
              </div>
            </div>
            <span className="text-xs text-slate-400">
              {data.top_topics.length} topics detected
            </span>
          </div>

          <div className="h-52 w-full pt-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.top_topics} margin={{ left: 0, right: 15, top: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} opacity={0.6} />
                <XAxis dataKey="label" tick={AXIS_STYLE} />
                <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(241, 245, 249, 0.5)' }} />
                <Bar
                  dataKey="value"
                  name="Occurrences"
                  fill={SERIES_COLORS.comments}
                  radius={[4, 4, 0, 0]}
                  barSize={32}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  )
}
