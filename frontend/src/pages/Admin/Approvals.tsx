import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ScorePill,
  TagList,
} from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { approvalsApi } from '@/services/api'
import type { Approval, ApprovalType } from '@/types/api'
import { formatRelative } from '@/utils/format'

const ADMIN_TABS: { key: ApprovalType; label: string }[] = [
  { key: 'COMMENT', label: 'Comments' },
  { key: 'CONNECTION', label: 'Connections' },
  { key: 'CANDIDATE', label: 'Candidates' },
]

export function AdminApprovals() {
  const [tab, setTab] = useState<ApprovalType>('COMMENT')

  const counts = useQuery({ queryKey: ['approvals', 'counts'], queryFn: approvalsApi.counts })
  const approvals = useQuery({
    queryKey: ['approvals', { tab }],
    queryFn: () => approvalsApi.list({ type: tab, status: 'PENDING', page_size: 50 }),
    refetchInterval: 15_000,
  })

  return (
    <>
      <PageHeader
        title="Approvals"
        description="The workflow pauses here. Nothing is published until you approve it."
      />

      <div role="tablist" aria-label="Approval types" className="flex flex-wrap gap-1">
        {ADMIN_TABS.map(({ key, label }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={clsx(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === key
                ? 'bg-accent-soft text-accent'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
            )}
          >
            {label}
            {(counts.data?.[key] ?? 0) > 0 && <Badge tone="caution">{counts.data?.[key]}</Badge>}
          </button>
        ))}
      </div>

      {approvals.isLoading ? (
        <LoadingState />
      ) : approvals.error ? (
        <ErrorState error={approvals.error} onRetry={() => approvals.refetch()} />
      ) : !approvals.data?.items.length ? (
        <Card className="p-4">
          <EmptyState
            title="Nothing waiting"
            description="When the agent drafts something that needs your sign-off, it appears here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {approvals.data.items.map((approval) => (
            <AdminApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      )}
    </>
  )
}

function AdminApprovalCard({ approval }: { approval: Approval }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(approval.content ?? '')
  const [feedback, setFeedback] = useState('')

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['approvals'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const approve = useMutation({
    mutationFn: () =>
      approvalsApi.approve(approval.id, editing ? { edited_content: draft } : undefined),
    onSuccess: refresh,
  })
  const reject = useMutation({
    mutationFn: () => approvalsApi.reject(approval.id),
    onSuccess: refresh,
  })
  const regenerate = useMutation({
    mutationFn: () => approvalsApi.regenerate(approval.id, { feedback: feedback || undefined }),
    onSuccess: (updated) => {
      setDraft(updated.content ?? '')
      setFeedback('')
      setEditing(false)
      refresh()
    },
  })

  const isConnection = approval.approval_type === 'CONNECTION'
  const overLimit = isConnection && draft.length > 300

  return (
    <Card
      title={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Link
            to={`/admin/candidates/${approval.person.id}?campaign_id=${approval.campaign_id}`}
            className="text-sm font-semibold text-ink hover:text-accent"
          >
            {approval.person.full_name}
          </Link>
          <Badge>{approval.proposed_action.replace(/_/g, ' ')}</Badge>
          <span className="text-xs text-ink-faint">
            {approval.campaign_name} · {formatRelative(approval.created_at)}
          </span>
        </div>
      }
      action={<ScorePill score={approval.post_evaluation?.relevance_score ?? approval.ai_score} />}
    >
      <p className="text-xs text-ink-faint">
        {approval.person.headline ?? approval.person.job_title ?? '—'}
      </p>

      {approval.post && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-ink-muted">The post</p>
          <blockquote className="rounded-md border-l-2 border-border-subtle bg-surface-muted px-3 py-2.5 text-sm whitespace-pre-line text-ink">
            {approval.post.content}
          </blockquote>
          {approval.post.post_url && (
            <a
              href={approval.post.post_url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-1 inline-block text-xs text-accent hover:underline"
            >
              Open the original
            </a>
          )}
        </div>
      )}

      {approval.post_evaluation && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">Topics found</p>
            <TagList values={approval.post_evaluation.topics} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-ink-muted">AI reasoning</p>
            <p className="text-sm text-ink-muted">{approval.post_evaluation.reason}</p>
          </div>
        </div>
      )}

      {!approval.post_evaluation && approval.ai_reasoning && (
        <div className="mt-3">
          <p className="mb-1.5 text-xs font-medium text-ink-muted">AI reasoning</p>
          <p className="text-sm text-ink-muted">{approval.ai_reasoning}</p>
        </div>
      )}

      {approval.content !== null && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-xs font-medium text-ink-muted">
              {isConnection ? 'Suggested connection note' : 'Suggested comment'}
            </p>
            {isConnection && (
              <span className={clsx('tabular text-xs', overLimit ? 'text-critical' : 'text-ink-faint')}>
                {draft.length}/300
              </span>
            )}
          </div>

          {editing ? (
            <Textarea
              rows={4}
              value={draft}
              aria-label="Edit the generated content"
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <p className="rounded-md border border-border-subtle bg-surface-muted px-3 py-2.5 text-sm whitespace-pre-line text-ink">
              {draft}
            </p>
          )}
        </div>
      )}

      {regenerate.isPending || feedback ? (
        <div className="mt-3">
          <Textarea
            rows={2}
            value={feedback}
            placeholder="Optional: tell the agent what to change before regenerating"
            aria-label="Regeneration feedback"
            onChange={(event) => setFeedback(event.target.value)}
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          variant="primary"
          loading={approve.isPending}
          disabled={overLimit}
          onClick={() => approve.mutate()}
        >
          Approve
        </Button>
        <Button onClick={() => setEditing((value) => !value)}>
          {editing ? 'Stop editing' : 'Edit'}
        </Button>
        {approval.approval_type !== 'CANDIDATE' && (
          <Button loading={regenerate.isPending} onClick={() => regenerate.mutate()}>
            Regenerate
          </Button>
        )}
        <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate()}>
          Reject
        </Button>
        {!feedback && approval.approval_type !== 'CANDIDATE' && (
          <Button variant="ghost" onClick={() => setFeedback(' ')}>
            Add feedback
          </Button>
        )}
      </div>

      {(approve.isError || reject.error || regenerate.error) && (
        <div className="mt-3">
          <ErrorState error={approve.error ?? reject.error ?? regenerate.error} />
        </div>
      )}
    </Card>
  )
}
