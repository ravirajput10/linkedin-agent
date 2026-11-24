import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import {
  Search,
  Users,
  Sparkles,
  Clock,
  XCircle,
  Download,
  Building2,
  MapPin,
  ExternalLink,
  Filter,
  ArrowUpDown,
  RefreshCw,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { campaignsApi, candidatesApi } from '@/services/api'

type StatusFilter = 'all' | 'high_match' | 'waiting' | 'rejected' | 'connected'
type SortOrder = 'score_desc' | 'score_asc' | 'name_asc'

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
      .join('') || 'C'
  )
}

function getStatusBadgeStyle(state?: string | null) {
  if (!state) {
    return {
      label: 'DISCOVERED',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      dotClass: 'bg-slate-400',
    }
  }

  const s = state.toUpperCase()
  if (s.includes('REJECTED') || s.includes('FAILED')) {
    return {
      label: s.replace(/_/g, ' '),
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
      dotClass: 'bg-rose-500',
    }
  }

  if (s.includes('WAITING') || s.includes('PENDING') || s.includes('DELAY')) {
    return {
      label: s.replace(/_/g, ' '),
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
      dotClass: 'bg-amber-500',
    }
  }

  if (s.includes('CONNECT') || s.includes('COMPLETED') || s.includes('RUNNING') || s.includes('SENT')) {
    return {
      label: s.replace(/_/g, ' '),
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900',
      dotClass: 'bg-emerald-500',
    }
  }

  return {
    label: s.replace(/_/g, ' '),
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900',
    dotClass: 'bg-blue-500',
  }
}

export function Candidates() {
  const auth = useOptionalAuth()
  const [params, setParams] = useSearchParams()

  // Admins must use dedicated /admin/candidates view
  if (auth?.isAdmin) {
    const qs = params.toString() ? `?${params.toString()}` : ''
    return <Navigate to={`/admin/candidates${qs}`} replace />
  }

  const campaignIdParam = params.get('campaign_id') ? Number(params.get('campaign_id')) : undefined
  const [selectedCampaignId, setSelectedCampaignId] = useState<number | undefined>(campaignIdParam)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('score_desc')

  // Fetch live campaigns for filter dropdown
  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list({ page_size: 50 }),
  })

  // Fetch candidates from live API
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['candidates', { campaignId: selectedCampaignId, search }],
    queryFn: () =>
      candidatesApi.list({
        campaign_id: selectedCampaignId,
        search: search.trim() || undefined,
        page_size: 100,
      }),
  })

  const rawCandidates = data?.items ?? []

  // KPI Metrics calculated from all candidates in this scope
  const stats = useMemo(() => {
    const total = rawCandidates.length
    const highMatch = rawCandidates.filter((c) => (c.match_score ?? 0) >= 75).length
    const inPipeline = rawCandidates.filter(
      (c) =>
        c.workflow &&
        c.workflow.state !== 'CANDIDATE_REJECTED' &&
        c.workflow.state !== 'FAILED',
    ).length
    const rejected = rawCandidates.filter(
      (c) =>
        c.workflow?.state === 'CANDIDATE_REJECTED' ||
        (c.match_score !== null && c.match_score < 70),
    ).length

    return { total, highMatch, inPipeline, rejected }
  }, [rawCandidates])

  // Filtered & sorted candidates
  const processedCandidates = useMemo(() => {
    let list = [...rawCandidates]

    // Status filter
    if (statusFilter === 'high_match') {
      list = list.filter((c) => (c.match_score ?? 0) >= 75)
    } else if (statusFilter === 'waiting') {
      list = list.filter((c) => {
        const s = c.workflow?.state ?? ''
        return s.includes('WAITING') || s.includes('PENDING') || s.includes('DELAY')
      })
    } else if (statusFilter === 'rejected') {
      list = list.filter(
        (c) =>
          c.workflow?.state === 'CANDIDATE_REJECTED' ||
          (c.match_score !== null && c.match_score < 70),
      )
    } else if (statusFilter === 'connected') {
      list = list.filter((c) => {
        const s = c.workflow?.state ?? ''
        return s.includes('CONNECT') || s.includes('COMPLETED') || s.includes('SENT')
      })
    }

    // Sort order
    list.sort((a, b) => {
      if (sortOrder === 'score_desc') {
        return (b.match_score ?? 0) - (a.match_score ?? 0)
      }
      if (sortOrder === 'score_asc') {
        return (a.match_score ?? 0) - (b.match_score ?? 0)
      }
      if (sortOrder === 'name_asc') {
        return a.person.full_name.localeCompare(b.person.full_name)
      }
      return 0
    })

    return list
  }, [rawCandidates, statusFilter, sortOrder])

  // Export current list to CSV
  const handleExportCsv = () => {
    if (!processedCandidates.length) return

    const headers = ['Full Name', 'Job Title', 'Company', 'Location', 'Match Score', 'State', 'Next Action', 'LinkedIn URL']
    const rows = processedCandidates.map((c) => [
      `"${c.person.full_name.replace(/"/g, '""')}"`,
      `"${(c.person.job_title || c.person.headline || '').replace(/"/g, '""')}"`,
      `"${(c.person.company || '').replace(/"/g, '""')}"`,
      `"${(c.person.location || '').replace(/"/g, '""')}"`,
      c.match_score ?? 0,
      `"${(c.workflow?.state || 'DISCOVERED').replace(/"/g, '""')}"`,
      `"${(c.next_action || c.discovery_reason || '').replace(/"/g, '""')}"`,
      `"${c.person.profile_url || ''}"`,
    ])

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `candidates_export_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCampaignChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value
    if (val === 'all') {
      setSelectedCampaignId(undefined)
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('campaign_id')
        return next
      })
    } else {
      const id = Number(val)
      setSelectedCampaignId(id)
      setParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('campaign_id', String(id))
        return next
      })
    }
  }

  return (
    <div className="space-y-4 pb-12 text-slate-900 dark:text-slate-100">
      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Candidates
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Profiles discovered and evaluated by the agent, with match scores and decision reasons.
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

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={!processedCandidates.length}
            className="h-8.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-200"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            <span>Export CSV</span>
          </Button>

          <Link to="/campaigns">
            <Button
              size="sm"
              className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8.5 px-3.5 rounded-lg shadow-2xs"
            >
              <span>View Campaigns</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* ================= 4 KPI STATS CARDS ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Discovered</span>
            <div className="size-6 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#2445C8]">
              <Users className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.total}</span>
            <span className="text-[11px] text-slate-400 truncate">prospects</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">High Fit (75+)</span>
            <div className="size-6 rounded-md bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <Sparkles className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.highMatch}</span>
            <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 truncate">
              {stats.total > 0 ? `${Math.round((stats.highMatch / stats.total) * 100)}% match` : 'qualified'}
            </span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">In Sequence / Delay</span>
            <div className="size-6 rounded-md bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
              <Clock className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.inPipeline}</span>
            <span className="text-[11px] text-slate-400 truncate">active delay</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Filtered Out</span>
            <div className="size-6 rounded-md bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500">
              <XCircle className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.rejected}</span>
            <span className="text-[11px] text-slate-400 truncate">unmatched</span>
          </div>
        </Card>
      </div>

      {/* ================= FILTER & SEARCH TOOLBAR ================= */}
      <Card className="rounded-xl border border-slate-200/90 dark:border-border p-3 sm:p-4 shadow-2xs bg-white dark:bg-card space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Search bar */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
            <Input
              value={search}
              placeholder="Search by name, company, or job title..."
              aria-label="Search candidates"
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 pr-8 h-9 text-xs sm:text-sm bg-slate-50/70 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800"
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

          {/* Campaign Selector & Sort */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <Filter className="size-3.5 text-slate-400" />
              <span className="font-medium hidden sm:inline">Campaign:</span>
              <select
                value={selectedCampaignId !== undefined ? String(selectedCampaignId) : 'all'}
                onChange={handleCampaignChange}
                className="h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                <option value="all">All Campaigns</option>
                {campaignsData?.items.map((camp) => (
                  <option key={camp.id} value={camp.id}>
                    {camp.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <ArrowUpDown className="size-3.5 text-slate-400" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                <option value="score_desc">Highest Match</option>
                <option value="score_asc">Lowest Match</option>
                <option value="name_asc">Name (A → Z)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 border-t border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              statusFilter === 'all'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            All Candidates ({rawCandidates.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('high_match')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              statusFilter === 'high_match'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Qualified 75+ ({stats.highMatch})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('waiting')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              statusFilter === 'waiting'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Waiting Connection ({stats.inPipeline})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('connected')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              statusFilter === 'connected'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Engaged / Sent
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('rejected')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              statusFilter === 'rejected'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Rejected ({stats.rejected})
          </button>
        </div>
      </Card>

      {/* ================= CANDIDATES TABLE CARD ================= */}
      <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card ring-0 overflow-hidden">
        {isLoading ? (
          <div className="p-8">
            <LoadingState label="Discovering & loading candidates..." />
          </div>
        ) : error ? (
          <div className="p-8">
            <ErrorState error={error} onRetry={() => refetch()} />
          </div>
        ) : !processedCandidates.length ? (
          <div className="p-8">
            <EmptyState
              title={search || statusFilter !== 'all' ? 'No candidates match your filter' : 'No candidates discovered yet'}
              description={
                search || statusFilter !== 'all'
                  ? 'Try clearing your search query or switching to another filter.'
                  : 'Start or run a campaign and the AI agent will populate high-fit candidates here.'
              }
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
                  <Link to="/campaigns/new">
                    <Button size="sm" className="mt-2 bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs">
                      Create New Campaign
                    </Button>
                  </Link>
                )
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50/80 dark:bg-slate-900/50">
                <TableRow className="border-b border-slate-200/80 dark:border-border text-xs text-slate-500 font-semibold uppercase tracking-wider">
                  <TableHead className="py-3 px-4 min-w-[240px]">Candidate</TableHead>
                  <TableHead className="py-3 px-4 min-w-[160px]">Company & Location</TableHead>
                  <TableHead className="py-3 px-4 min-w-[120px]">Match Score</TableHead>
                  <TableHead className="py-3 px-4 min-w-[170px]">Workflow State</TableHead>
                  <TableHead className="py-3 px-4 min-w-[220px]">Next Action / Reason</TableHead>
                  <TableHead className="py-3 px-4 text-right min-w-[110px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {processedCandidates.map((candidate) => {
                  const initials = getInitials(candidate.person.full_name)
                  const avatarColor = getAvatarColor(candidate.person.full_name)
                  const statusInfo = getStatusBadgeStyle(candidate.workflow?.state)
                  const score = candidate.match_score ?? 0

                  return (
                    <TableRow
                      key={`${candidate.campaign_id}-${candidate.person.id}`}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Name & Avatar */}
                      <TableCell className="py-3 px-4">
                        <div className="flex items-start gap-3">
                          <div
                            className={`size-9 rounded-lg shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-2xs ${avatarColor}`}
                          >
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <Link
                              to={`/candidates/${candidate.person.id}?campaign_id=${candidate.campaign_id}`}
                              className="font-semibold text-sm text-slate-900 dark:text-white hover:text-[#2445C8] dark:hover:text-blue-400 transition-colors block truncate"
                            >
                              {candidate.person.full_name}
                            </Link>
                            <p
                              className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-xs mt-0.5"
                              title={candidate.person.headline ?? candidate.person.job_title ?? undefined}
                            >
                              {candidate.person.headline || candidate.person.job_title || 'LinkedIn Member'}
                            </p>
                          </div>
                        </div>
                      </TableCell>

                      {/* Company & Location */}
                      <TableCell className="py-3 px-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-800 dark:text-slate-200">
                            <Building2 className="size-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{candidate.person.company || '—'}</span>
                          </div>
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                            <MapPin className="size-3 text-slate-400 shrink-0" />
                            <span className="truncate">{candidate.person.location || '—'}</span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Score */}
                      <TableCell className="py-3 px-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold tabular-nums border ${
                                score >= 80
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                                  : score >= 70
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800'
                                  : score >= 50
                                  ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
                                  : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800'
                              }`}
                            >
                              {score}/100
                            </span>
                          </div>
                          <div className="w-20 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                score >= 80
                                  ? 'bg-emerald-500'
                                  : score >= 70
                                  ? 'bg-[#2445C8]'
                                  : score >= 50
                                  ? 'bg-amber-500'
                                  : 'bg-rose-500'
                              }`}
                              style={{ width: `${Math.min(100, Math.max(8, score))}%` }}
                            />
                          </div>
                        </div>
                      </TableCell>

                      {/* State */}
                      <TableCell className="py-3 px-4">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border ${statusInfo.badgeClass}`}
                        >
                          <span className={`size-1.5 rounded-full shrink-0 ${statusInfo.dotClass}`} />
                          <span className="truncate">{statusInfo.label}</span>
                        </span>
                      </TableCell>

                      {/* Next Action / Reasoning */}
                      <TableCell className="py-3 px-4">
                        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium line-clamp-1">
                          {candidate.next_action || 'Next step in campaign workflow'}
                        </p>
                        {candidate.discovery_reason && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                            {candidate.discovery_reason}
                          </p>
                        )}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {candidate.person.profile_url && (
                            <a
                              href={candidate.person.profile_url}
                              target="_blank"
                              rel="noreferrer noopener"
                              title="Open on LinkedIn"
                              className="size-7 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-500 hover:text-[#2445C8] hover:border-[#2445C8] transition-colors"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                          <Link
                            to={`/candidates/${candidate.person.id}?campaign_id=${candidate.campaign_id}`}
                          >
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:text-[#2445C8] dark:hover:text-blue-400"
                            >
                              <span>Details</span>
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  )
}
