import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Activity as ActivityIcon,
  Search,
  RefreshCw,
  ArrowRightLeft,
  Send,
  MessageSquare,
  ThumbsUp,
  AlertTriangle,
  AlertCircle,
  Clock,
  Filter,
  Download,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { useActivityStream } from '@/hooks/useActivityStream'
import { activityApi } from '@/services/api'
import type { Activity as ActivityEntry, LogLevel } from '@/types/api'
import { formatDateTime, formatRelative } from '@/utils/format'

type LevelFilter = 'all' | 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'

function getEventStyle(eventType: string, level: LogLevel) {
  if (level === 'ERROR') {
    return {
      Icon: AlertCircle,
      iconClass: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
    }
  }
  if (level === 'WARNING') {
    return {
      Icon: AlertTriangle,
      iconClass: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
    }
  }
  if (eventType.includes('connection')) {
    return {
      Icon: Send,
      iconClass: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
    }
  }
  if (eventType.includes('comment')) {
    return {
      Icon: MessageSquare,
      iconClass: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900',
      badgeClass: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900',
    }
  }
  if (eventType.includes('like')) {
    return {
      Icon: ThumbsUp,
      iconClass: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
    }
  }
  if (eventType.includes('workflow') || eventType.includes('state')) {
    return {
      Icon: ArrowRightLeft,
      iconClass: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-900',
      badgeClass: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-900',
    }
  }
  return {
    Icon: ActivityIcon,
    iconClass: 'text-slate-600 bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
  }
}

export function Activity() {
  const auth = useOptionalAuth()

  // Guard for admins: redirect to dedicated /admin/activity route
  if (auth?.isAdmin) {
    return <Navigate to="/admin/activity" replace />
  }

  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const history = useQuery({
    queryKey: ['activity', { level: levelFilter !== 'all' ? levelFilter : undefined }],
    queryFn: () => activityApi.list({ level: levelFilter !== 'all' ? (levelFilter as LogLevel) : undefined, page_size: 100 }),
    refetchInterval: 30_000,
  })

  const { events: live, connected } = useActivityStream()

  /** Live events prepend to history; the id set keeps duplicates out. */
  const allEntries = useMemo<ActivityEntry[]>(() => {
    const historical = history.data?.items ?? []
    const seen = new Set(historical.map((entry) => entry.id))
    const fresh = live.filter(
      (entry) => !seen.has(entry.id) && (levelFilter === 'all' || entry.level === levelFilter),
    )
    return [...fresh, ...historical]
  }, [history.data, live, levelFilter])

  // KPI Calculations
  const stats = useMemo(() => {
    const total = allEntries.length
    const actions = allEntries.filter((e) => e.event_type.includes('action') || e.event_type.includes('completed')).length
    const stateTransitions = allEntries.filter((e) => e.event_type.includes('workflow') || e.event_type.includes('state')).length
    const alerts = allEntries.filter((e) => e.level === 'WARNING' || e.level === 'ERROR').length

    return { total, actions, stateTransitions, alerts }
  }, [allEntries])

  // Filtered entries
  const filteredEntries = useMemo(() => {
    let list = [...allEntries]

    // Event type filter
    if (eventTypeFilter !== 'all') {
      list = list.filter((e) => e.event_type.toLowerCase().includes(eventTypeFilter.toLowerCase()))
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (e) =>
          e.message.toLowerCase().includes(q) ||
          e.event_type.toLowerCase().includes(q) ||
          e.level.toLowerCase().includes(q),
      )
    }

    return list
  }, [allEntries, eventTypeFilter, search])

  return (
    <div className="space-y-4 pb-12 text-slate-900 dark:text-slate-100">
      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Agent activity
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Real-time feed of decisions, actions, and workflow state transitions executed by the AI agent.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Live stream status indicator */}
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border ${
              connected
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                connected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            <span>{connected ? 'Live Stream' : 'Reconnecting…'}</span>
          </span>

          <Button
            variant="outline"
            size="sm"
            onClick={() => history.refetch()}
            disabled={history.isFetching}
            className="h-8.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${history.isFetching ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </Button>

          <a
            href={activityApi.exportCsvUrl({ level: levelFilter !== 'all' ? levelFilter : undefined })}
            download="agent-activity.csv"
            className="inline-flex items-center gap-1.5 h-8.5 px-3 text-xs font-medium rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted text-slate-700 dark:text-slate-200 shadow-2xs transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Export CSV</span>
          </a>

          <Link to="/scheduled-actions">
            <Button
              size="sm"
              className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8.5 px-3.5 rounded-lg shadow-2xs"
            >
              <span>Scheduled Actions</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* ================= COMPACT 4-KPI ROW ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Events</span>
            <div className="size-6 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#2445C8]">
              <ActivityIcon className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.total}</span>
            <span className="text-[11px] text-slate-400 truncate">events recorded</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Actions Completed</span>
            <div className="size-6 rounded-md bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <Send className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.actions}</span>
            <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 truncate">likes, comments, connects</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">State Transitions</span>
            <div className="size-6 rounded-md bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center text-indigo-600">
              <ArrowRightLeft className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.stateTransitions}</span>
            <span className="text-[11px] text-slate-400 truncate">pipeline advances</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Alerts & Errors</span>
            <div className="size-6 rounded-md bg-rose-50 dark:bg-rose-950/50 flex items-center justify-center text-rose-600">
              <AlertTriangle className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.alerts}</span>
            <span className="text-[11px] text-slate-400 truncate">issues noticed</span>
          </div>
        </Card>
      </div>

      {/* ================= FILTER & SEARCH TOOLBAR ================= */}
      <Card className="rounded-xl border border-slate-200/90 dark:border-border p-3 sm:p-3.5 shadow-2xs bg-white dark:bg-card space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <Input
              value={search}
              placeholder="Filter by message, prospect name, or event..."
              aria-label="Search agent activity"
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8 h-8.5 text-xs bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                ✕
              </button>
            )}
          </div>

          {/* Event type filter */}
          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
            <Filter className="size-3.5 text-slate-400" />
            <span className="font-medium hidden sm:inline">Type:</span>
            <select
              value={eventTypeFilter}
              onChange={(e) => setEventTypeFilter(e.target.value)}
              className="h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
            >
              <option value="all">All Event Types</option>
              <option value="workflow_state_changed">State Transitions</option>
              <option value="action_completed">Actions Completed</option>
              <option value="connection">Connections</option>
              <option value="comment">Comments</option>
              <option value="like">Likes</option>
            </select>
          </div>
        </div>

        {/* Level filter tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setLevelFilter('all')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              levelFilter === 'all'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            All Levels ({allEntries.length})
          </button>
          <button
            type="button"
            onClick={() => setLevelFilter('INFO')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              levelFilter === 'INFO'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Info
          </button>
          <button
            type="button"
            onClick={() => setLevelFilter('WARNING')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              levelFilter === 'WARNING'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Warnings
          </button>
          <button
            type="button"
            onClick={() => setLevelFilter('ERROR')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              levelFilter === 'ERROR'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Errors
          </button>
          <button
            type="button"
            onClick={() => setLevelFilter('DEBUG')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              levelFilter === 'DEBUG'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Debug
          </button>
        </div>
      </Card>

      {/* ================= COMPACT EVENT STREAM ================= */}
      <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card ring-0 overflow-hidden">
        {history.isLoading ? (
          <div className="p-8">
            <LoadingState label="Loading agent activity log..." />
          </div>
        ) : history.error ? (
          <div className="p-8">
            <ErrorState error={history.error} onRetry={() => history.refetch()} />
          </div>
        ) : !filteredEntries.length ? (
          <div className="p-8">
            <EmptyState
              title={search || levelFilter !== 'all' || eventTypeFilter !== 'all' ? 'No events match your filter' : 'No activity yet'}
              description={
                search || levelFilter !== 'all' || eventTypeFilter !== 'all'
                  ? 'Try resetting your search query or selecting a different level.'
                  : 'Start a campaign to see the autonomous agent perform actions in real time.'
              }
              action={
                search || levelFilter !== 'all' || eventTypeFilter !== 'all' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setLevelFilter('all')
                      setEventTypeFilter('all')
                    }}
                    className="mt-2 text-xs"
                  >
                    Reset Filters
                  </Button>
                ) : (
                  <Link to="/campaigns/new">
                    <Button size="sm" className="mt-2 bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs">
                      Create Campaign
                    </Button>
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredEntries.map((entry) => {
              const { Icon, iconClass, badgeClass } = getEventStyle(entry.event_type, entry.level)

              return (
                <li
                  key={entry.id}
                  className="px-3.5 py-2.5 sm:px-4 sm:py-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors flex items-start gap-3"
                >
                  {/* Event icon badge */}
                  <div
                    className={`size-7 rounded-md shrink-0 flex items-center justify-center border shadow-2xs mt-0.5 ${iconClass}`}
                  >
                    <Icon className="size-3.5" />
                  </div>

                  {/* Event Content */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <p className="text-xs sm:text-sm font-medium text-slate-800 dark:text-slate-100 break-words leading-snug">
                          {entry.message}
                        </p>
                        <span
                          className={`inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-semibold border ${badgeClass}`}
                        >
                          {entry.event_type}
                        </span>
                      </div>

                      {/* Timestamp */}
                      <span
                        className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 ml-auto flex items-center gap-1"
                        title={formatDateTime(entry.created_at)}
                      >
                        <Clock className="size-3 text-slate-400" />
                        <span>{formatRelative(entry.created_at)}</span>
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
