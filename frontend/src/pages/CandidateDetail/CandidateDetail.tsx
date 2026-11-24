import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'

import { useOptionalAuth } from '@/auth/AuthContext'
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ScorePill,
  StatusBadge,
  TagList,
} from '@/components/ui'
import { candidatesApi } from '@/services/api'
import type { Post } from '@/types/api'
import { formatDateTime, formatRelative, humanize } from '@/utils/format'

export function CandidateDetail() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const auth = useOptionalAuth()
  const personId = Number(id)

  if (auth?.isAdmin) {
    const qs = params.toString() ? `?${params.toString()}` : ''
    return <Navigate to={`/admin/candidates/${personId}${qs}`} replace />
  }

  const campaignId = params.get('campaign_id') ? Number(params.get('campaign_id')) : undefined

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['candidates', personId, campaignId],
    queryFn: () => candidatesApi.get(personId, campaignId),
    enabled: Number.isFinite(personId),
    refetchInterval: 15_000,
  })

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  const { person, workflow, evaluation, posts, timeline } = data
  const engaged = posts.filter((post) => post.sequence_index !== null)

  return (
    <>
      <PageHeader
        title={person.full_name}
        description={person.headline ?? undefined}
        action={
          <a
            href={person.profile_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center rounded-md border border-border-subtle bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            Open profile
          </a>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Profile" className="lg:col-span-2">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Job title" value={person.job_title} />
            <Detail label="Company" value={person.company} />
            <Detail label="Industry" value={person.industry} />
            <Detail label="Location" value={person.location} />
            <Detail label="Connection status" value={humanize(person.connection_status)} />
            <Detail label="Last activity" value={formatRelative(person.last_activity_at)} />
          </dl>

          {data.matched_criteria.length > 0 && (
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Matched criteria</p>
              <TagList values={data.matched_criteria} />
            </div>
          )}

          {data.discovery_reason && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium text-ink-muted">Why they were discovered</p>
              <p className="text-sm text-ink-muted">{data.discovery_reason}</p>
            </div>
          )}
        </Card>

        <Card title="Workflow">
          {workflow ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium text-ink-muted">Current state</p>
                <div className="mt-1">
                  <StatusBadge status={workflow.state} />
                </div>
              </div>
              <Detail label="Next action" value={data.next_action} />
              <Detail label="Match score" value={null}>
                <ScorePill score={data.match_score} />
              </Detail>
              <Detail label="Started" value={formatDateTime(workflow.started_at)} />
              {workflow.completed_at && (
                <Detail label="Completed" value={formatDateTime(workflow.completed_at)} />
              )}
              {workflow.last_error_message && (
                <div>
                  <p className="text-xs font-medium text-ink-muted">Last error</p>
                  <p className="mt-0.5 text-sm text-critical">{workflow.last_error_message}</p>
                </div>
              )}
            </div>
          ) : (
            <EmptyState title="No workflow yet" />
          )}
        </Card>
      </div>

      {evaluation && (
        <Card
          title="AI evaluation"
          action={
            <span className="text-xs text-ink-faint">
              {evaluation.provider} · {evaluation.model} · prompt {evaluation.prompt_version}
            </span>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <ScorePill score={evaluation.score} />
            <Badge tone={evaluation.is_match ? 'positive' : 'critical'}>
              {evaluation.is_match ? 'Match' : 'No match'}
            </Badge>
          </div>
          <p className="mt-3 text-sm text-ink-muted">{evaluation.reason}</p>
          {evaluation.risk_flags.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-ink-muted">Risk flags</p>
              <TagList values={evaluation.risk_flags} />
            </div>
          )}
        </Card>
      )}

      <Card title="Post history">
        {engaged.length === 0 ? (
          <EmptyState title="No posts processed yet" />
        ) : (
          <ul className="space-y-3">
            {engaged
              .sort((a, b) => (a.sequence_index ?? 0) - (b.sequence_index ?? 0))
              .map((post) => (
                <PostRow key={post.id} post={post} />
              ))}
          </ul>
        )}

        {posts.some((post) => !post.is_eligible) && (
          <details className="mt-4">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted">
              Show {posts.filter((post) => !post.is_eligible).length} items filtered out
            </summary>
            <ul className="mt-2 space-y-1.5">
              {posts
                .filter((post) => !post.is_eligible)
                .map((post) => (
                  <li key={post.id} className="text-xs text-ink-faint">
                    <span className="text-ink-muted">{post.content.slice(0, 70)}…</span>{' '}
                    — {post.ineligibility_reason}
                  </li>
                ))}
            </ul>
          </details>
        )}
      </Card>

      <Card title="Timeline">
        {timeline.length === 0 ? (
          <EmptyState title="No steps recorded yet" />
        ) : (
          <ol className="relative space-y-3 border-l border-border-subtle pl-5">
            {timeline.map((step) => (
              <li key={step.id} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-[1.4rem] top-1.5 size-2 rounded-full bg-accent"
                />
                <p className="text-sm text-ink">{humanize(step.to_state)}</p>
                {step.summary && <p className="text-xs text-ink-muted">{step.summary}</p>}
                <p className="text-xs text-ink-faint">{formatDateTime(step.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  )
}

function PostRow({ post }: { post: Post }) {
  const evaluation = post.evaluations?.[0]
  return (
    <li className="rounded-md border border-border-subtle p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone="accent">Post #{post.sequence_index}</Badge>
          <StatusBadge status={post.processing_status} />
        </div>
        <div className="flex items-center gap-2">
          {evaluation && <ScorePill score={evaluation.relevance_score} />}
          <span className="text-xs text-ink-faint">{formatRelative(post.published_at)}</span>
        </div>
      </div>
      <p className="mt-2 text-sm whitespace-pre-line text-ink-muted">{post.content}</p>
      {evaluation && (
        <div className="mt-2 border-t border-border-subtle pt-2">
          <TagList values={evaluation.topics} />
          <p className="mt-1.5 text-xs text-ink-muted">{evaluation.reason}</p>
        </div>
      )}
    </li>
  )
}

function Detail({
  label,
  value,
  children,
}: {
  label: string
  value?: string | null
  children?: React.ReactNode
}) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children ?? value ?? '—'}</dd>
    </div>
  )
}
