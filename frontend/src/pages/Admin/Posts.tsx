import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

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
import { postsApi } from '@/services/api'
import { formatRelative } from '@/utils/format'

export function AdminPosts() {
  const [eligibleOnly, setEligibleOnly] = useState(true)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['posts', { eligibleOnly }],
    queryFn: () => postsApi.list({ eligible_only: eligibleOnly, page_size: 50 }),
  })

  return (
    <>
      <PageHeader
        title="Posts"
        description="Everything the agent read, including what it filtered out and why."
      />

      <Card
        action={
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={eligibleOnly}
              onChange={(event) => setEligibleOnly(event.target.checked)}
              className="size-4 rounded border-border-subtle text-accent focus:ring-accent/30"
            />
            Eligible only
          </label>
        }
        title="Feed"
      >
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data?.items.length ? (
          <EmptyState
            title="No posts yet"
            description="Posts appear once a campaign starts discovering candidates."
          />
        ) : (
          <ul className="space-y-3">
            {data.items.map((post) => {
              const evaluation = post.evaluations?.[0]
              return (
                <li key={post.id} className="rounded-md border border-border-subtle p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/admin/candidates/${post.person_id}`}
                        className="text-sm font-medium text-ink hover:text-accent"
                      >
                        Author #{post.person_id}
                      </Link>
                      <Badge>{post.post_type}</Badge>
                      <StatusBadge status={post.processing_status} />
                      {!post.is_eligible && <Badge tone="critical">Filtered out</Badge>}
                    </div>
                    <div className="flex items-center gap-2">
                      {evaluation && <ScorePill score={evaluation.relevance_score} />}
                      <span className="text-xs text-ink-faint">
                        {formatRelative(post.published_at)}
                      </span>
                    </div>
                  </div>

                  <p className="mt-2 text-sm whitespace-pre-line text-ink-muted">{post.content}</p>

                  {post.ineligibility_reason && (
                    <p className="mt-2 text-xs text-caution">{post.ineligibility_reason}</p>
                  )}

                  {evaluation && (
                    <div className="mt-2 border-t border-border-subtle pt-2">
                      <TagList values={evaluation.topics} />
                      <p className="mt-1.5 text-xs text-ink-muted">{evaluation.reason}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </>
  )
}
