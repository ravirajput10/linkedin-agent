import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import {
  Clock,
  Send,
  CheckCircle2,
  XCircle,
  Search,
  RefreshCw,
  Calendar,
  AlertCircle,
  Play,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { scheduledActionsApi } from '@/services/api'
import type { ScheduledAction } from '@/types/api'
import { formatDateTime, formatRelative, toLocalInputValue } from '@/utils/format'

type StatusFilter = 'all' | 'scheduled' | 'completed' | 'cancelled'

const AVATAR_COLORS = [
  'bg-blue-600',
  'bg-indigo-600',
  'bg-violet-600',
  'bg-emerald-600',
  'bg-teal-600',
  'bg-rose-600',
  'bg-amber-600',
]

function getAvatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

function getInitials(name: string): string {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('') || 'S'
  )
}

function getTaskTypeBadge(type: string) {
  if (type === 'CONNECTION') {
    return {
      label: 'CONNECTION',
      badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800',
      icon: Send,
    }
  }
  return {
    label: type,
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
    icon: Clock,
  }
}

export function ScheduledActions() {
  const auth = useOptionalAuth()

  // Guard for admins: redirect to dedicated admin route
  if (auth?.isAdmin) {
    return <Navigate to="/admin/scheduled-actions" replace />
  }

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['scheduled-actions'],
    queryFn: () => scheduledActionsApi.list({ page_size: 100 }),
    refetchInterval: 30_000,
  })

  const rawActions = data?.items ?? []

  // KPI Calculations
  const stats = useMemo(() => {
    const total = rawActions.length
    const scheduled = rawActions.filter((a) => a.status === 'SCHEDULED').length
    const connection = rawActions.filter((a) => a.task_type === 'CONNECTION').length
    const completed = rawActions.filter((a) => a.status === 'COMPLETED').length
    const cancelled = rawActions.filter((a) => a.status === 'CANCELLED' || a.status === 'FAILED').length

    return { total, scheduled, connection, completed, cancelled }
  }, [rawActions])

  // Filtered actions list
  const filteredActions = useMemo(() => {
    let list = [...rawActions]

    // Status tab filter
    if (statusFilter === 'scheduled') {
      list = list.filter((a) => a.status === 'SCHEDULED')
    } else if (statusFilter === 'completed') {
      list = list.filter((a) => a.status === 'COMPLETED')
    } else if (statusFilter === 'cancelled') {
      list = list.filter((a) => a.status === 'CANCELLED' || a.status === 'FAILED')
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (a) =>
          a.person?.full_name.toLowerCase().includes(q) ||
          a.person?.company?.toLowerCase().includes(q) ||
          a.campaign_name.toLowerCase().includes(q) ||
          a.task_type.toLowerCase().includes(q),
      )
    }

    return list
  }, [rawActions, statusFilter, search])

  return (
    <div className="space-y-4 pb-12 text-slate-900 dark:text-slate-100">
      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Scheduled actions
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Delayed jobs live in the database, so they survive restarts. Each one revalidates before it runs.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <Link to="/candidates">
            <Button
              size="sm"
              className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8.5 px-3.5 rounded-lg shadow-2xs"
            >
              <span>View Candidates</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* ================= COMPACT 4-KPI ROW ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Queued</span>
            <div className="size-6 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#2445C8]">
              <Clock className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.scheduled}</span>
            <span className="text-[11px] text-slate-400 truncate">scheduled</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Connection Requests</span>
            <div className="size-6 rounded-md bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <Send className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.connection}</span>
            <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 truncate">pending sequence</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Completed Actions</span>
            <div className="size-6 rounded-md bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
              <CheckCircle2 className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.completed}</span>
            <span className="text-[11px] text-slate-400 truncate">executed</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Cancelled / Failed</span>
            <div className="size-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
              <XCircle className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.cancelled}</span>
            <span className="text-[11px] text-slate-400 truncate">stopped</span>
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
              placeholder="Search by prospect name, campaign, or task..."
              aria-label="Search scheduled actions"
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

          {/* Status Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                statusFilter === 'all'
                  ? 'bg-[#2445C8] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              All ({rawActions.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('scheduled')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                statusFilter === 'scheduled'
                  ? 'bg-[#2445C8] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Scheduled ({stats.scheduled})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('completed')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                statusFilter === 'completed'
                  ? 'bg-[#2445C8] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Completed ({stats.completed})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('cancelled')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                statusFilter === 'cancelled'
                  ? 'bg-[#2445C8] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              Cancelled ({stats.cancelled})
            </button>
          </div>
        </div>
      </Card>

      {/* ================= COMPACT ACTION LIST ================= */}
      <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card ring-0 overflow-hidden">
        {isLoading ? (
          <div className="p-8">
            <LoadingState label="Loading scheduled queue..." />
          </div>
        ) : error ? (
          <div className="p-8">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : !filteredActions.length ? (
          <div className="p-8">
            <EmptyState
              title="Nothing scheduled"
              description="Connection requests are scheduled once the engagement sequence completes."
              action={
                search || statusFilter !== 'all' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setStatusFilter('all')
                    }}
                    className="mt-2 text-xs"
                  >
                    Reset Filters
                  </Button>
                ) : (
                  <Link to="/campaigns">
                    <Button size="sm" className="mt-2 bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs">
                      View Campaigns
                    </Button>
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800/80">
            {filteredActions.map((action) => (
              <CompactScheduledRow key={action.id} action={action} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function CompactScheduledRow({ action }: { action: ScheduledAction }) {
  const queryClient = useQueryClient()
  const [rescheduling, setRescheduling] = useState(false)
  const [when, setWhen] = useState(() => toLocalInputValue(action.scheduled_at))

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['scheduled-actions'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const cancel = useMutation({
    mutationFn: () => scheduledActionsApi.cancel(action.id),
    onSuccess: refresh,
  })
  const runNow = useMutation({
    mutationFn: () => scheduledActionsApi.runNow(action.id),
    onSuccess: refresh,
  })
  const reschedule = useMutation({
    mutationFn: () => scheduledActionsApi.reschedule(action.id, new Date(when).toISOString()),
    onSuccess: () => {
      setRescheduling(false)
      refresh()
    },
  })

  const isOpen = action.status === 'SCHEDULED'
  const personName = action.person?.full_name || 'Prospect'
  const initials = getInitials(personName)
  const avatarColor = getAvatarColor(personName)
  const taskBadge = getTaskTypeBadge(action.task_type)

  return (
    <li className="px-3.5 py-2.5 sm:px-4 sm:py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: Prospect Avatar, Name, Campaign & Task */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`size-7 rounded-md shrink-0 flex items-center justify-center text-white text-[11px] font-bold shadow-2xs ${avatarColor}`}
          >
            {initials}
          </div>

          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              {action.person ? (
                <Link
                  to={`/candidates/${action.person.id}?campaign_id=${action.campaign_id}`}
                  className="font-bold text-slate-900 dark:text-white hover:text-[#2445C8] dark:hover:text-blue-400 transition-colors truncate"
                >
                  {action.person.full_name}
                </Link>
              ) : (
                <span className="font-bold text-slate-900 dark:text-white">—</span>
              )}

              {/* Status Badge */}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                <span className="size-1 rounded-full bg-amber-500 animate-pulse" />
                <span>{action.status}</span>
              </span>

              {/* Task Type Badge */}
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[10px] font-semibold border ${taskBadge.badgeClass}`}>
                <span>{action.task_type}</span>
              </span>
            </div>

            {/* Subline: Campaign Name & Due Time */}
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              <span className="font-medium text-slate-700 dark:text-slate-300 truncate">
                {action.campaign_name}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1 text-slate-400 dark:text-slate-500 truncate">
                <Calendar className="size-3 text-slate-400 shrink-0" />
                <span>due {formatDateTime(action.scheduled_at)} ({formatRelative(action.scheduled_at)})</span>
              </span>
            </div>

            {action.error_message && (
              <p className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-1">
                <AlertCircle className="size-3 shrink-0" />
                <span>{action.error_message}</span>
              </p>
            )}
          </div>
        </div>

        {/* Right: Action Buttons */}
        {isOpen && (
          <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-center">
            <Button
              variant="outline"
              size="sm"
              disabled={runNow.isPending}
              onClick={() => runNow.mutate()}
              className="h-7 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-[#2445C8] dark:hover:text-blue-400"
            >
              <Play className={`size-3 mr-1 ${runNow.isPending ? 'animate-spin' : ''}`} />
              <span>Run now</span>
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setRescheduling((v) => !v)}
              className="h-7 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-slate-900"
            >
              <span>Reschedule</span>
            </Button>

            <Button
              variant="destructive"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
              className="h-7 px-2.5 text-xs font-medium bg-rose-600 hover:bg-rose-700 text-white"
            >
              <span>Cancel</span>
            </Button>
          </div>
        )}
      </div>

      {/* Reschedule Inline Panel */}
      {rescheduling && (
        <div className="mt-2.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center gap-2">
          <div className="w-56">
            <Input
              type="datetime-local"
              value={when}
              aria-label="New scheduled time"
              onChange={(event) => setWhen(event.target.value)}
              className="h-7 text-xs bg-white dark:bg-card"
            />
          </div>
          <Button
            size="sm"
            disabled={reschedule.isPending}
            onClick={() => reschedule.mutate()}
            className="h-7 px-3 text-xs bg-[#2445C8] hover:bg-[#1d38a8] text-white font-medium"
          >
            <span>Save</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRescheduling(false)}
            className="h-7 px-2 text-xs text-slate-500"
          >
            <span>Dismiss</span>
          </Button>
          {reschedule.isError && (
            <span className="text-xs text-rose-600 dark:text-rose-400">
              {(reschedule.error as Error).message}
            </span>
          )}
        </div>
      )}
    </li>
  )
}
