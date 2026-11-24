import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import {
  Search,
  FileText,
  ThumbsUp,
  MessageSquare,
  ExternalLink,
  Sparkles,
  XCircle,
  Filter,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Building2,
  ArrowUpDown,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState, ErrorState, LoadingState } from '@/components/ui'
import { candidatesApi, postsApi } from '@/services/api'
import type { Post } from '@/types/api'
import { formatRelative } from '@/utils/format'

type FilterTab = 'all' | 'eligible' | 'engaged' | 'rejected'
type SortOrder = 'recent' | 'score_desc'

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
      .join('') || 'A'
  )
}

function getStatusBadge(status: string, isEligible: boolean) {
  if (!isEligible) {
    return {
      label: 'FILTERED OUT',
      badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900',
      dotClass: 'bg-rose-500',
    }
  }

  const s = status.toUpperCase()
  if (s.includes('WOULD_LIKE') || s.includes('WOULD_COMMENT')) {
    return {
      label: s.replace(/_/g, ' ') + ' (dry run)',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900',
      dotClass: 'bg-amber-500',
    }
  }

  if (s.includes('LIKE') || s.includes('COMMENT') || s.includes('COMPLETED')) {
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

export function Posts() {
  const auth = useOptionalAuth()

  // Guard for admins: redirect to /admin/posts
  if (auth?.isAdmin) {
    return <Navigate to="/admin/posts" replace />
  }

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [postTypeFilter, setPostTypeFilter] = useState<string>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('recent')
  const [search, setSearch] = useState('')

  // Fetch posts from API (request unfiltered from API so client tabs can switch instantly)
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['posts'],
    queryFn: () => postsApi.list({ eligible_only: false, page_size: 100 }),
  })

  // Fetch candidate profiles to enrich author name and headline
  const { data: candidatesData } = useQuery({
    queryKey: ['candidates-lookup'],
    queryFn: () => candidatesApi.list({ page_size: 100 }),
    staleTime: 60_000,
  })

  const authorMap = useMemo(() => {
    const map = new Map<number, { name: string; headline: string | null; company: string | null }>()
    if (candidatesData?.items) {
      for (const item of candidatesData.items) {
        map.set(item.person.id, {
          name: item.person.full_name,
          headline: item.person.headline || item.person.job_title,
          company: item.person.company,
        })
      }
    }
    return map
  }, [candidatesData])

  const rawPosts = data?.items ?? []

  // KPI calculations
  const stats = useMemo(() => {
    const total = rawPosts.length
    const eligible = rawPosts.filter((p) => p.is_eligible).length
    const engaged = rawPosts.filter(
      (p) =>
        p.processing_status.toUpperCase().includes('LIKE') ||
        p.processing_status.toUpperCase().includes('COMMENT'),
    ).length
    const rejected = rawPosts.filter((p) => !p.is_eligible).length

    return { total, eligible, engaged, rejected }
  }, [rawPosts])

  // Filtered & sorted posts
  const processedPosts = useMemo(() => {
    let list = [...rawPosts]

    // Status Tab filter
    if (activeTab === 'eligible') {
      list = list.filter((p) => p.is_eligible)
    } else if (activeTab === 'engaged') {
      list = list.filter(
        (p) =>
          p.processing_status.toUpperCase().includes('LIKE') ||
          p.processing_status.toUpperCase().includes('COMMENT'),
      )
    } else if (activeTab === 'rejected') {
      list = list.filter((p) => !p.is_eligible)
    }

    // Post Type filter
    if (postTypeFilter !== 'all') {
      list = list.filter((p) => p.post_type.toUpperCase() === postTypeFilter.toUpperCase())
    }

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => {
        const author = authorMap.get(p.person_id)
        const authorMatch = author?.name?.toLowerCase().includes(q) || false
        const contentMatch = p.content.toLowerCase().includes(q)
        const topicMatch = p.evaluations?.[0]?.topics?.some((t) => t.toLowerCase().includes(q))
        return authorMatch || contentMatch || topicMatch
      })
    }

    // Sorting
    list.sort((a, b) => {
      if (sortOrder === 'score_desc') {
        const scoreA = a.evaluations?.[0]?.relevance_score ?? 0
        const scoreB = b.evaluations?.[0]?.relevance_score ?? 0
        return scoreB - scoreA
      }
      // 'recent' by published_at or created_at
      const timeA = new Date(a.published_at || a.created_at).getTime()
      const timeB = new Date(b.published_at || b.created_at).getTime()
      return timeB - timeA
    })

    return list
  }, [rawPosts, activeTab, postTypeFilter, search, sortOrder, authorMap])

  return (
    <div className="space-y-4 pb-12 text-slate-900 dark:text-slate-100">
      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Posts Feed
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Everything the agent discovered, analyzed, and evaluated for outreach sequences.
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

      {/* ================= COMPACT KPI CARDS ================= */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Analyzed</span>
            <div className="size-6 rounded-md bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-[#2445C8]">
              <FileText className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.total}</span>
            <span className="text-[11px] text-slate-400 truncate">posts read</span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Eligible Posts</span>
            <div className="size-6 rounded-md bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600">
              <Sparkles className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{stats.eligible}</span>
            <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 truncate">
              {stats.total > 0 ? `${Math.round((stats.eligible / stats.total) * 100)}% passed` : 'relevant'}
            </span>
          </div>
        </Card>

        <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3 py-2.5 shadow-2xs bg-white dark:bg-card">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Engaged / Queued</span>
            <div className="size-6 rounded-md bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600">
              <ThumbsUp className="size-3.5" />
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white tabular-nums">{stats.engaged}</span>
            <span className="text-[11px] text-slate-400 truncate">likes & comments</span>
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
            <span className="text-[11px] text-slate-400 truncate">low relevance</span>
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
              placeholder="Search post text, topics, or author name..."
              aria-label="Search posts"
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

          {/* Type Filter & Sort */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <Filter className="size-3.5 text-slate-400" />
              <span className="font-medium hidden sm:inline">Type:</span>
              <select
                value={postTypeFilter}
                onChange={(e) => setPostTypeFilter(e.target.value)}
                className="h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                <option value="all">All Post Types</option>
                <option value="TEXT">Text</option>
                <option value="ARTICLE">Article</option>
                <option value="IMAGE">Image</option>
                <option value="POLL">Poll</option>
                <option value="REPOST">Repost</option>
              </select>
            </div>

            <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
              <ArrowUpDown className="size-3.5 text-slate-400" />
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="h-9 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                <option value="recent">Most Recent</option>
                <option value="score_desc">Highest AI Score</option>
              </select>
            </div>
          </div>
        </div>

        {/* Status Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 border-t border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'all'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            All Posts ({rawPosts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('eligible')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'eligible'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Eligible ({stats.eligible})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('engaged')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'engaged'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Engaged / Liked ({stats.engaged})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rejected')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'rejected'
                ? 'bg-[#2445C8] text-white shadow-2xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 dark:bg-slate-800 dark:text-slate-300'
            }`}
          >
            Filtered Out ({stats.rejected})
          </button>
        </div>
      </Card>

      {/* ================= POSTS FEED LIST ================= */}
      <div className="space-y-2">
        {isLoading ? (
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-8 bg-white dark:bg-card">
            <LoadingState label="Reading and analyzing prospect posts..." />
          </Card>
        ) : error ? (
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-6 bg-white dark:bg-card">
            <ErrorState error={error} onRetry={() => refetch()} />
          </Card>
        ) : !processedPosts.length ? (
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-8 bg-white dark:bg-card">
            <EmptyState
              title={search || activeTab !== 'all' || postTypeFilter !== 'all' ? 'No posts match your filters' : 'No posts recorded yet'}
              description={
                search || activeTab !== 'all' || postTypeFilter !== 'all'
                  ? 'Try clearing your search query or selecting a different status filter.'
                  : 'Start a campaign to discover candidates, and their recent LinkedIn posts will stream into this feed.'
              }
              action={
                search || activeTab !== 'all' || postTypeFilter !== 'all' ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setSearch('')
                      setActiveTab('all')
                      setPostTypeFilter('all')
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
          </Card>
        ) : (
          processedPosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              authorInfo={authorMap.get(post.person_id)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PostCard({
  post,
  authorInfo,
}: {
  post: Post
  authorInfo?: { name: string; headline: string | null; company: string | null }
}) {
  const [expanded, setExpanded] = useState(false)
  const evaluation = post.evaluations?.[0]
  const statusInfo = getStatusBadge(post.processing_status, post.is_eligible)

  const authorName = authorInfo?.name || `Author #${post.person_id}`
  const authorHeadline = authorInfo?.headline || 'LinkedIn Prospect'
  const authorCompany = authorInfo?.company
  const initials = getInitials(authorName)
  const avatarColor = getAvatarColor(authorName)

  const isLong = post.content.length > 220
  const displayedContent = expanded || !isLong ? post.content : post.content.slice(0, 220) + '…'
  const score = evaluation?.relevance_score

  return (
    <Card className="rounded-lg border border-slate-200/90 dark:border-border px-3.5 py-2.5 shadow-2xs bg-white dark:bg-card hover:border-slate-300 dark:hover:border-slate-700 transition-all">
      {/* Compact Header: Author & Status Badges */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          {/* Avatar */}
          <div
            className={`size-6 rounded-md shrink-0 flex items-center justify-center text-white text-[10px] font-bold shadow-2xs ${avatarColor}`}
          >
            {initials}
          </div>

          {/* Author Name, Company & Headline */}
          <div className="flex items-center gap-1.5 min-w-0 text-xs truncate">
            <Link
              to={`/candidates/${post.person_id}`}
              className="font-bold text-slate-900 dark:text-white hover:text-[#2445C8] dark:hover:text-blue-400 transition-colors truncate"
            >
              {authorName}
            </Link>

            {authorCompany && (
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
                <Building2 className="size-2.5 text-slate-400 shrink-0" />
                {authorCompany}
              </span>
            )}

            {authorHeadline && (
              <span className="hidden md:inline text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-xs">
                · {authorHeadline}
              </span>
            )}
          </div>
        </div>

        {/* Right Badges & Time */}
        <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
          <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-1.5 py-0.2 font-semibold">
            {post.post_type}
          </Badge>

          <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.2 rounded font-semibold border ${statusInfo.badgeClass}`}
          >
            <span className={`size-1.5 rounded-full shrink-0 ${statusInfo.dotClass}`} />
            <span>{statusInfo.label}</span>
          </span>

          {score !== undefined && score !== null && (
            <span
              className={`inline-flex items-center px-1.5 py-0.2 rounded font-bold tabular-nums border ${
                score >= 80
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                  : score >= 60
                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800'
                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800'
              }`}
            >
              {score}/100
            </span>
          )}

          <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-0.5" title={post.published_at || undefined}>
            {formatRelative(post.published_at || post.created_at)}
          </span>
        </div>
      </div>

      {/* Post Content */}
      <div className="pt-1.5 pb-1">
        <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
          {displayedContent}
        </p>

        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-0.5 text-[11px] font-semibold text-[#2445C8] hover:text-[#1d38a8] dark:text-blue-400 inline-flex items-center gap-0.5 transition-colors"
          >
            {expanded ? (
              <>
                <span>Show less</span>
                <ChevronUp className="size-3" />
              </>
            ) : (
              <>
                <span>More</span>
                <ChevronDown className="size-3" />
              </>
            )}
          </button>
        )}
      </div>

      {/* Compact ineligibility reason if filtered out */}
      {post.ineligibility_reason && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50/70 dark:bg-rose-950/30 px-2 py-0.5 rounded border border-rose-200/80 dark:border-rose-900/60">
          <XCircle className="size-3 shrink-0 text-rose-500" />
          <span className="truncate">
            <span className="font-semibold">Reason filtered:</span> {post.ineligibility_reason}
          </span>
        </div>
      )}

      {/* Compact AI Evaluation Analysis */}
      {evaluation && (
        <div className="mt-1 rounded bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 px-2 py-1 text-[11px] flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 font-semibold text-[#2445C8] dark:text-blue-400">
            <Sparkles className="size-3" />
            AI Fit {evaluation.relevance_score}/100
          </span>

          {evaluation.topics && evaluation.topics.length > 0 && (
            <div className="flex items-center gap-1">
              {evaluation.topics.slice(0, 3).map((topic) => (
                <span
                  key={topic}
                  className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800"
                >
                  #{topic}
                </span>
              ))}
            </div>
          )}

          {evaluation.reason && (
            <span className="italic text-slate-500 dark:text-slate-400 truncate max-w-md">
              "{evaluation.reason}"
            </span>
          )}
        </div>
      )}

      {/* Compact Footer: Stats & Links */}
      <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/70 flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <ThumbsUp className="size-3 text-slate-400" />
            <span>{post.like_count ?? 0}</span>
          </span>
          <span className="flex items-center gap-1">
            <MessageSquare className="size-3 text-slate-400" />
            <span>{post.comment_count ?? 0}</span>
          </span>
          {post.sequence_index !== null && (
            <span className="text-[10px] font-medium text-[#2445C8] dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-1.5 py-0.2 rounded">
              Step {post.sequence_index}
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {post.post_url && (
            <a
              href={post.post_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-[#2445C8] dark:text-slate-400 dark:hover:text-blue-400 transition-colors"
            >
              <span>LinkedIn</span>
              <ExternalLink className="size-2.5" />
            </a>
          )}
          <Link
            to={`/candidates/${post.person_id}`}
            className="text-[11px] font-semibold text-[#2445C8] hover:text-[#1d38a8] dark:text-blue-400 hover:underline"
          >
            Candidate Profile →
          </Link>
        </div>
      </div>
    </Card>
  )
}
