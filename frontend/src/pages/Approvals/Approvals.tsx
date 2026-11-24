import { useState, useMemo, useEffect } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { approvalsApi, contentStudioApi } from '@/services/api'
import { formatRelative } from '@/utils/format'

export function Approvals() {
  const auth = useOptionalAuth()
  const isAdmin = auth?.isAdmin ?? false

  if (isAdmin) {
    return <Navigate to="/admin/approvals" replace />
  }

  return <UserApprovals />
}



/**
 * =========================================================================
 * NEW USER APPROVALS (Modern 2-Column Master-Detail Layout)
 * =========================================================================
 */
export type UserApprovalCategory =
  | 'ALL'
  | 'COMMENTS'
  | 'CONNECTION_NOTES'
  | 'MESSAGES'
  | 'POSTS'
  | 'CANDIDATES'

interface ApprovalItemView {
  id: string | number
  rawApprovalId?: number
  type: 'Comment' | 'Connect note' | 'Post' | 'Message' | 'Candidate'
  category: UserApprovalCategory
  timeAgo: string
  personName: string
  personTitle: string
  personId?: number
  campaignName: string
  campaignId?: number
  status: string
  snippet: string
  theirPost?: string
  postUrl?: string
  aiDraft: string
  whyReason: string
  topics?: string[]
  imageUrl?: string
}

function UserApprovals() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')?.toUpperCase() as UserApprovalCategory | undefined
  const [activeCategory, setActiveCategory] = useState<UserApprovalCategory>(
    tabParam && ['ALL', 'COMMENTS', 'CONNECTION_NOTES', 'MESSAGES', 'POSTS', 'CANDIDATES'].includes(tabParam)
      ? tabParam
      : 'ALL'
  )

  useEffect(() => {
    if (tabParam && ['ALL', 'COMMENTS', 'CONNECTION_NOTES', 'MESSAGES', 'POSTS', 'CANDIDATES'].includes(tabParam)) {
      setActiveCategory(tabParam)
    }
  }, [tabParam])

  const handleCategoryChange = (cat: UserApprovalCategory) => {
    setActiveCategory(cat)
    setSearchParams(cat === 'ALL' ? {} : { tab: cat })
  }
  const [items, setItems] = useState<ApprovalItemView[]>([])
  const [selectedItemId, setSelectedItemId] = useState<string | number | null>(null)
  const [editedDraft, setEditedDraft] = useState<string>('')
  const [optionalFeedback, setOptionalFeedback] = useState<string>('')
  const [notification, setNotification] = useState<string | null>(null)
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false)

  // Fetch live outreach approvals
  const liveApprovalsQuery = useQuery({
    queryKey: ['approvals', 'all'],
    queryFn: () => approvalsApi.list({ status: 'PENDING', page_size: 50 }),
    refetchInterval: 15_000,
  })

  // Fetch pending user posts from Content Studio
  const userPostsQuery = useQuery({
    queryKey: ['user-posts-pending'],
    queryFn: () => contentStudioApi.listPosts(),
    refetchInterval: 15_000,
  })

  // Synchronize live outreach items + Content Studio posts
  useEffect(() => {
    const outreachItems: ApprovalItemView[] = (liveApprovalsQuery.data?.items || []).map((app) => {
      let type: ApprovalItemView['type'] = 'Comment'
      let cat: UserApprovalCategory = 'COMMENTS'
      if (app.approval_type === 'CONNECTION') {
        type = 'Connect note'
        cat = 'CONNECTION_NOTES'
      } else if (app.approval_type === 'CANDIDATE') {
        type = 'Candidate'
        cat = 'CANDIDATES'
      }

      return {
        id: app.id,
        rawApprovalId: app.id,
        type,
        category: cat,
        timeAgo: formatRelative(app.created_at),
        personName: app.person.full_name,
        personTitle: app.person.headline || app.person.job_title || app.person.company || 'Profile',
        personId: app.person.id,
        campaignName: app.campaign_name,
        campaignId: app.campaign_id,
        status: 'Pending',
        snippet: (app.content || app.ai_reasoning || 'Proposed action awaiting sign-off').slice(0, 85) + '...',
        theirPost: app.post?.content || undefined,
        postUrl: app.post?.post_url || undefined,
        aiDraft: app.content || '',
        whyReason: app.ai_reasoning || app.post_evaluation?.reason || `${app.proposed_action.replace(/_/g, ' ')}`,
        topics: app.post_evaluation?.topics || undefined,
      }
    })

    const pendingPosts: ApprovalItemView[] = (userPostsQuery.data || [])
      .filter((p) => p.status === 'WAITING_APPROVAL')
      .map((p) => ({
        id: `post-${p.id}`,
        rawApprovalId: p.id,
        type: 'Post',
        category: 'POSTS',
        timeAgo: formatRelative(p.created_at),
        personName: p.title,
        personTitle: `Content Studio · ${p.post_format || 'Post'} · ${p.best_time || 'Scheduled'}`,
        personId: p.id,
        campaignName: 'Content Studio',
        status: 'Pending',
        snippet: p.content.slice(0, 85) + '...',
        theirPost: undefined,
        postUrl: undefined,
        aiDraft: p.content,
        whyReason: `Authored in Content Studio (Voice match: ${p.voice_match_score || 92}%). Suggested slot: ${p.best_time || 'Next slot'}.`,
        topics: [p.post_format || 'Post', p.best_time || 'Scheduled'],
        imageUrl: p.image_url || (p.metrics as any)?.image_url || undefined,
      }))

    const combined = [...outreachItems, ...pendingPosts]
    setItems(combined)

    if (combined.length > 0) {
      setSelectedItemId((prev) => (combined.some((m) => m.id === prev) ? prev : combined[0].id))
      setEditedDraft((_prev) => {
        const match = combined.find((m) => m.id === selectedItemId)
        return match ? match.aiDraft : combined[0].aiDraft
      })
    } else {
      setSelectedItemId(null)
      setEditedDraft('')
    }
  }, [liveApprovalsQuery.data, userPostsQuery.data])

  const showNotification = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3500)
  }

  // Category counts
  const counts = useMemo(() => {
    return {
      ALL: items.length,
      COMMENTS: items.filter((i) => i.category === 'COMMENTS').length,
      CONNECTION_NOTES: items.filter((i) => i.category === 'CONNECTION_NOTES').length,
      MESSAGES: items.filter((i) => i.category === 'MESSAGES').length,
      POSTS: items.filter((i) => i.category === 'POSTS').length,
      CANDIDATES: items.filter((i) => i.category === 'CANDIDATES').length,
    }
  }, [items])

  // Filter items by tab
  const filteredItems = useMemo(() => {
    if (activeCategory === 'ALL') return items
    if (activeCategory === 'COMMENTS') return items.filter((i) => i.category === 'COMMENTS')
    if (activeCategory === 'CONNECTION_NOTES') return items.filter((i) => i.category === 'CONNECTION_NOTES')
    if (activeCategory === 'MESSAGES') return items.filter((i) => i.category === 'MESSAGES')
    if (activeCategory === 'POSTS') return items.filter((i) => i.category === 'POSTS')
    if (activeCategory === 'CANDIDATES') return items.filter((i) => i.category === 'CANDIDATES')
    return items
  }, [items, activeCategory])

  // Count of total comments for batch button
  const commentCount = useMemo(() => {
    return items.filter((i) => i.type === 'Comment').length
  }, [items])

  const selectedItem = useMemo(() => {
    const found = items.find((i) => i.id === selectedItemId)
    return found || filteredItems[0] || null
  }, [items, selectedItemId, filteredItems])

  const handleSelectItem = (item: ApprovalItemView) => {
    setSelectedItemId(item.id)
    setEditedDraft(item.aiDraft)
    setOptionalFeedback('')
  }

  // Approve single item
  const handleApprove = async () => {
    if (!selectedItem) return

    if (selectedItem.rawApprovalId) {
      try {
        if (selectedItem.type === 'Post') {
          await contentStudioApi.approvePost(Number(selectedItem.rawApprovalId))
          void queryClient.invalidateQueries({ queryKey: ['user-posts-pending'] })
          void queryClient.invalidateQueries({ queryKey: ['content-calendar'] })
          void queryClient.invalidateQueries({ queryKey: ['approvals'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          showNotification(`Approved and scheduled post: "${selectedItem.personName}"`)
        } else {
          await approvalsApi.approve(Number(selectedItem.rawApprovalId), { edited_content: editedDraft })
          void queryClient.invalidateQueries({ queryKey: ['approvals'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          showNotification(`Approved and queued: "${selectedItem.personName}"`)
        }
      } catch (e: any) {
        showNotification(e?.message || 'Failed to approve item.')
      }
    }

    const remaining = items.filter((i) => i.id !== selectedItem.id)
    setItems(remaining)
    if (remaining.length > 0) {
      setSelectedItemId(remaining[0].id)
      setEditedDraft(remaining[0].aiDraft)
    } else {
      setSelectedItemId(null)
      setEditedDraft('')
    }
  }

  // Reject single item
  const handleReject = async (actionLabel = 'Rejected') => {
    if (!selectedItem) return

    if (selectedItem.rawApprovalId) {
      try {
        if (selectedItem.type === 'Post') {
          await contentStudioApi.rejectPost(Number(selectedItem.rawApprovalId))
          void queryClient.invalidateQueries({ queryKey: ['user-posts-pending'] })
          void queryClient.invalidateQueries({ queryKey: ['content-calendar'] })
          void queryClient.invalidateQueries({ queryKey: ['approvals'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          showNotification(`Rejected post: "${selectedItem.personName}"`)
        } else {
          await approvalsApi.reject(Number(selectedItem.rawApprovalId))
          void queryClient.invalidateQueries({ queryKey: ['approvals'] })
          void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
          showNotification(`${actionLabel} approval item for ${selectedItem.personName}.`)
        }
      } catch (e: any) {
        showNotification(e?.message || 'Failed to reject item.')
      }
    }

    const remaining = items.filter((i) => i.id !== selectedItem.id)
    setItems(remaining)
    if (remaining.length > 0) {
      setSelectedItemId(remaining[0].id)
      setEditedDraft(remaining[0].aiDraft)
    } else {
      setSelectedItemId(null)
      setEditedDraft('')
    }
  }

  // Skip person from campaign and reject approval
  const handleSkipPerson = async () => {
    if (!selectedItem) return

    if (selectedItem.type === 'Post') {
      await handleReject('Rejected')
      return
    }

    if (selectedItem.rawApprovalId) {
      try {
        await approvalsApi.skipPerson(Number(selectedItem.rawApprovalId))
        void queryClient.invalidateQueries({ queryKey: ['approvals'] })
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
        showNotification(`Skipped person "${selectedItem.personName}" from campaign.`)
      } catch (e: any) {
        showNotification(e?.message || 'Failed to skip person.')
      }
    }

    const remaining = items.filter((i) => i.id !== selectedItem.id)
    setItems(remaining)
    if (remaining.length > 0) {
      setSelectedItemId(remaining[0].id)
      setEditedDraft(remaining[0].aiDraft)
    } else {
      setSelectedItemId(null)
      setEditedDraft('')
    }
  }

  // Regenerate draft
  const handleRegenerate = async () => {
    if (!selectedItem) return
    setIsRegenerating(true)

    if (selectedItem.rawApprovalId) {
      try {
        const updated = await approvalsApi.regenerate(selectedItem.rawApprovalId, {
          feedback: optionalFeedback || undefined,
        })
        if (updated.content) {
          setEditedDraft(updated.content)
          setItems((prev) =>
            prev.map((i) => (i.id === selectedItem.id ? { ...i, aiDraft: updated.content! } : i))
          )
        }
        showNotification('AI draft regenerated with fresh angle!')
      } catch (e: any) {
        showNotification(e?.message || 'Failed to regenerate draft.')
      } finally {
        setIsRegenerating(false)
        setOptionalFeedback('')
      }
    }
  }

  // Batch approve comments
  const handleApproveAllComments = async () => {
    try {
      const res = await approvalsApi.bulkApprove({ type: 'COMMENT' })
      void queryClient.invalidateQueries({ queryKey: ['approvals'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      showNotification(`Approved all ${res.approved_count} pending comments!`)
      const remaining = items.filter((i) => i.type !== 'Comment')
      setItems(remaining)
      if (remaining.length > 0) {
        setSelectedItemId(remaining[0].id)
        setEditedDraft(remaining[0].aiDraft)
      } else {
        setSelectedItemId(null)
        setEditedDraft('')
      }
    } catch (e: any) {
      showNotification(e?.message || 'Failed to bulk approve comments.')
    }
  }

  const isOverLimit = selectedItem?.type === 'Connect note' && editedDraft.length > 300

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-10">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs text-white shadow-xl dark:bg-slate-100 dark:text-slate-900 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
          <span>{notification}</span>
        </div>
      )}

      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Approvals
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Nothing here goes live until you approve it. Items expire after 48 hours and are skipped.
          </p>
        </div>

        {commentCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleApproveAllComments}
            className="shadow-2xs font-semibold text-xs h-8 px-3.5 bg-white dark:bg-card border-slate-200 dark:border-border hover:bg-slate-50"
          >
            Approve all comments ({commentCount})
          </Button>
        )}
      </div>

      {/* ================= CATEGORY TABS ================= */}
      <div className="flex items-center gap-5 border-b border-slate-200/90 dark:border-border pb-1 overflow-x-auto">
        <button
          type="button"
          onClick={() => handleCategoryChange('ALL')}
          className={`pb-2 text-xs sm:text-sm font-semibold transition-all relative shrink-0 ${
            activeCategory === 'ALL'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-1'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          All · {items.length}
        </button>

        <button
          type="button"
          onClick={() => handleCategoryChange('COMMENTS')}
          className={`pb-2 text-xs sm:text-sm font-semibold transition-all relative shrink-0 ${
            activeCategory === 'COMMENTS'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-1'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Comments {counts.COMMENTS > 0 ? `· ${counts.COMMENTS}` : ''}
        </button>

        <button
          type="button"
          onClick={() => handleCategoryChange('CONNECTION_NOTES')}
          className={`pb-2 text-xs sm:text-sm font-semibold transition-all relative shrink-0 ${
            activeCategory === 'CONNECTION_NOTES'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-1'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Connection notes {counts.CONNECTION_NOTES > 0 ? `· ${counts.CONNECTION_NOTES}` : ''}
        </button>

        <button
          type="button"
          onClick={() => handleCategoryChange('MESSAGES')}
          className={`pb-2 text-xs sm:text-sm font-semibold transition-all relative shrink-0 ${
            activeCategory === 'MESSAGES'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-1'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Messages {counts.MESSAGES > 0 ? `· ${counts.MESSAGES}` : ''}
        </button>

        <button
          type="button"
          onClick={() => handleCategoryChange('POSTS')}
          className={`pb-2 text-xs sm:text-sm font-semibold transition-all relative shrink-0 ${
            activeCategory === 'POSTS'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-1'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Your posts {counts.POSTS > 0 ? `· ${counts.POSTS}` : ''}
        </button>

        <button
          type="button"
          onClick={() => handleCategoryChange('CANDIDATES')}
          className={`pb-2 text-xs sm:text-sm font-semibold transition-all relative shrink-0 ${
            activeCategory === 'CANDIDATES'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-1'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Candidates {counts.CANDIDATES > 0 ? `· ${counts.CANDIDATES}` : ''}
        </button>
      </div>

      {/* ================= 2-COLUMN MASTER-DETAIL LAYOUT ================= */}
      {filteredItems.length === 0 ? (
        <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-12 text-center bg-white dark:bg-card shadow-2xs">
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              Nothing waiting
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              When the agent drafts something that needs your sign-off, it appears here.
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* ---------------- LEFT COLUMN: APPROVALS LIST (5 cols) ---------------- */}
          <div className="lg:col-span-5 space-y-2.5">
            {filteredItems.map((item) => {
              const isSelected = selectedItem?.id === item.id

              // Type badge tone
              let badgeColor = 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
              if (item.type === 'Connect note') {
                badgeColor = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
              } else if (item.type === 'Post') {
                badgeColor = 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300'
              } else if (item.type === 'Message') {
                badgeColor = 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
              } else if (item.type === 'Candidate') {
                badgeColor = 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
              }

              return (
                <div
                  key={item.id}
                  onClick={() => handleSelectItem(item)}
                  className={`cursor-pointer rounded-2xl border p-4 transition-all shadow-2xs bg-white dark:bg-card ${
                    isSelected
                      ? 'border-[#2445C8] dark:border-blue-500 ring-1 ring-[#2445C8] dark:ring-blue-500 shadow-xs'
                      : 'border-slate-200/90 dark:border-border hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${badgeColor}`}
                    >
                      {item.type}
                    </span>
                    <span className="text-[11px] text-slate-400 font-medium">
                      {item.timeAgo}
                    </span>
                  </div>

                  <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                    {item.personName} · {item.personTitle}
                  </div>

                  <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-1 leading-relaxed">
                    {item.snippet}
                  </p>

                  <div className="text-[11px] text-slate-400 mt-2">
                    {item.campaignName} · {item.status}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ---------------- RIGHT COLUMN: PREVIEW & ACTION PANE (7 cols) ---------------- */}
          {selectedItem && (
            <div className="lg:col-span-7">
              <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-5 sm:p-6 shadow-2xs bg-white dark:bg-card ring-0 space-y-4">
                {/* Header Context & Candidate Link */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md ${
                        selectedItem.type === 'Connect note'
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : selectedItem.type === 'Post'
                          ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300'
                          : selectedItem.type === 'Message'
                          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                      }`}
                    >
                      {selectedItem.type}
                    </span>
                    <span className="text-xs text-slate-400">
                      {selectedItem.campaignName} · drafted {selectedItem.timeAgo}
                    </span>
                  </div>

                  {selectedItem.personId && (
                    <Link
                      to={`/candidates/${selectedItem.personId}?campaign_id=${selectedItem.campaignId}`}
                      className="text-xs font-semibold text-[#2445C8] dark:text-blue-400 hover:underline flex items-center gap-1"
                    >
                      <span>View candidate</span>
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>

                {/* Person Name & Headline */}
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                    {selectedItem.personName} · {selectedItem.personTitle}
                  </h2>
                </div>

                {/* THEIR POST BOX */}
                {selectedItem.theirPost && (
                  <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        THEIR POST
                      </span>
                      {selectedItem.postUrl && (
                        <a
                          href={selectedItem.postUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-[11px] font-semibold text-[#2445C8] dark:text-blue-400 hover:underline flex items-center gap-1"
                        >
                          <span>Open original</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                      {selectedItem.theirPost}
                    </p>
                  </div>
                )}

                {/* AI DRAFT EDITABLE TEXTAREA */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      AI DRAFT — EDIT BEFORE APPROVING
                    </label>
                    <span
                      className={`text-[10px] font-bold tracking-wider ${
                        isOverLimit ? 'text-red-500' : 'text-slate-400'
                      }`}
                    >
                      {editedDraft.length} CHARACTERS
                      {selectedItem.type === 'Connect note' && ' / 300'}
                    </span>
                  </div>

                  <Textarea
                    value={editedDraft}
                    onChange={(e) => setEditedDraft(e.target.value)}
                    rows={5}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs sm:text-sm text-slate-800 dark:text-slate-100 leading-relaxed placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-[#2445C8] resize-none"
                  />
                </div>

                {/* ATTACHED IMAGE PREVIEW FOR USER POSTS */}
                {selectedItem.imageUrl && (
                  <div className="rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 px-1">
                      Attached Image
                    </span>
                    <img
                      src={selectedItem.imageUrl}
                      alt="Attached post image"
                      className="w-full max-h-60 object-cover rounded-lg border border-slate-200/80 dark:border-slate-800"
                    />
                  </div>
                )}

                {/* WHY PILL / REASONING */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800/80 px-3 py-1 rounded-md">
                    <span>Why: {selectedItem.whyReason}</span>
                  </span>

                  {selectedItem.topics && selectedItem.topics.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      {selectedItem.topics.map((t, idx) => (
                        <span
                          key={idx}
                          className="text-[11px] font-medium text-slate-500 bg-slate-50 dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 px-2 py-0.5 rounded"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* OPTIONAL REGENERATION FEEDBACK INPUT */}
                {optionalFeedback !== '' ? (
                  <div className="space-y-1 pt-1">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      INSTRUCTION FOR AI REGENERATION
                    </label>
                    <Textarea
                      rows={2}
                      value={optionalFeedback}
                      onChange={(e) => setOptionalFeedback(e.target.value)}
                      placeholder="e.g. Make it more casual, mention their background in DevOps..."
                      className="text-xs rounded-lg"
                    />
                  </div>
                ) : null}

                {/* ACTION BUTTONS BAR */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      onClick={handleApprove}
                      disabled={isOverLimit}
                      className="bg-[#2445C8] hover:bg-[#1e3bb3] text-white font-semibold text-xs h-9 px-4 rounded-lg shadow-2xs"
                    >
                      {selectedItem.type === 'Comment'
                        ? 'Approve & post comment'
                        : selectedItem.type === 'Connect note'
                        ? 'Approve & send note'
                        : selectedItem.type === 'Candidate'
                        ? 'Approve candidate'
                        : selectedItem.type === 'Post'
                        ? 'Approve & schedule post'
                        : 'Approve & send'}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRegenerate}
                      disabled={isRegenerating}
                      className="font-semibold text-xs h-9 px-3.5 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                    >
                      {isRegenerating ? (
                        <>
                          <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                          <span>Regenerating...</span>
                        </>
                      ) : (
                        <span>Regenerate</span>
                      )}
                    </Button>

                    {optionalFeedback === '' && (
                      <button
                        type="button"
                        onClick={() => setOptionalFeedback(' ')}
                        className="text-xs text-slate-400 hover:text-slate-600 underline font-medium ml-1"
                      >
                        + Prompt feedback
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {selectedItem.type !== 'Post' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleSkipPerson}
                        className="font-semibold text-xs h-9 px-3.5 border-slate-200 dark:border-slate-800 hover:bg-slate-50 text-slate-700 dark:text-slate-300"
                      >
                        Skip this person
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleReject('Rejected')}
                      className="font-semibold text-xs h-9 px-3 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      {selectedItem.type === 'Post' ? 'Reject post' : 'Reject'}
                    </Button>
                  </div>
                </div>
              </Card>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
