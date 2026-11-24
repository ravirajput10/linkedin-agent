import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ScorePill,
  Stat,
  StatusBadge,
  TagList,
} from '@/components/ui'
import { CriteriaEditor } from '@/pages/CreateCampaign/CriteriaEditor'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { campaignsApi } from '@/services/api'
import type { Criteria } from '@/types/api'
import { formatDateTime } from '@/utils/format'

export function AdminCampaignDetail() {
  const { id } = useParams()
  const campaignId = Number(id)
  const queryClient = useQueryClient()
  const [draftCriteria, setDraftCriteria] = useState<Criteria | null>(null)

  const campaignQuery = useQuery({
    queryKey: ['campaigns', campaignId],
    queryFn: () => campaignsApi.get(campaignId),
    refetchInterval: 10_000,
    enabled: Number.isFinite(campaignId),
  })
  const campaign = campaignQuery.data

  const candidatesQuery = useQuery({
    queryKey: ['candidates', { campaignId }],
    queryFn: () => campaignsApi.candidates(campaignId, { page_size: 25 }),
    enabled: Number.isFinite(campaignId),
    refetchInterval: campaign?.status === 'RUNNING' ? 5_000 : false,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const start = useMutation({ mutationFn: () => campaignsApi.start(campaignId), onSuccess: invalidate })
  const pause = useMutation({ mutationFn: () => campaignsApi.pause(campaignId), onSuccess: invalidate })
  const resume = useMutation({ mutationFn: () => campaignsApi.resume(campaignId), onSuccess: invalidate })
  const stop = useMutation({ mutationFn: () => campaignsApi.stop(campaignId), onSuccess: invalidate })
  const runNow = useMutation({ mutationFn: () => campaignsApi.runNow(campaignId), onSuccess: invalidate })

  const saveCriteria = useMutation({
    mutationFn: (criteria: Criteria) => campaignsApi.update(campaignId, { criteria }),
    onSuccess: () => {
      setDraftCriteria(null)
      invalidate()
      void queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] })
    },
  })

  if (campaignQuery.isLoading) return <LoadingState />
  if (campaignQuery.error || !campaign) {
    return <ErrorState error={campaignQuery.error} onRetry={() => campaignQuery.refetch()} />
  }

  const stats = campaign.stats
  const criteria = draftCriteria ?? campaign.criteria
  const isRunning = campaign.status === 'RUNNING'

  return (
    <>
      <PageHeader
        title={campaign.name}
        description={campaign.instruction}
        action={
          <div className="flex flex-wrap gap-2">
            {campaign.status === 'DRAFT' && (
              <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
                Start Campaign
              </Button>
            )}
            {isRunning && (
              <>
                <Button loading={runNow.isPending} onClick={() => runNow.mutate()}>
                  Run now
                </Button>
                <Button loading={pause.isPending} onClick={() => pause.mutate()}>
                  Pause
                </Button>
                <Button variant="danger" loading={stop.isPending} onClick={() => stop.mutate()}>
                  Stop
                </Button>
              </>
            )}
            {(campaign.status === 'PAUSED' || campaign.status === 'STOPPED') && (
              <Button variant="primary" loading={resume.isPending} onClick={() => resume.mutate()}>
                Resume
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={campaign.status} />
        {campaign.dry_run && <Badge tone="caution">DRY RUN</Badge>}
        <span className="text-xs text-ink-faint">
          Created {formatDateTime(campaign.created_at)}
          {campaign.started_at && ` · Started ${formatDateTime(campaign.started_at)}`}
        </span>
      </div>

      {campaign.last_error && (
        <Card className="p-4">
          <p className="text-sm text-critical">{campaign.last_error}</p>
        </Card>
      )}

      <section aria-label="Campaign statistics" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Candidates found" value={stats.candidates_discovered} />
        <Stat label="Candidates matched" value={stats.candidates_matched} />
        <Stat label="Candidates processed" value={stats.candidates_processed} />
        <Stat label="Posts analyzed" value={stats.posts_analyzed} />
        <Stat label="Posts liked" value={stats.posts_liked} />
        <Stat label="Comments posted" value={`${stats.comments_posted}/${stats.comments_generated}`} />
        <Stat label="Connections sent" value={stats.connections_sent} />
        <Stat label="Pending approvals" value={stats.pending_approvals} />
      </section>

      <Card
        title="Candidates"
        action={
          <Link
            className="text-xs font-medium text-accent hover:underline"
            to={`/admin/candidates?campaign_id=${campaign.id}`}
          >
            View all
          </Link>
        }
      >
        {candidatesQuery.isLoading ? (
          <LoadingState />
        ) : !candidatesQuery.data?.items.length ? (
          <EmptyState
            title="No candidates yet"
            description={
              isRunning
                ? 'The agent is searching. Candidates appear here as they are discovered.'
                : 'Start the campaign to begin discovery.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {candidatesQuery.data.items.map((candidate) => (
              <li
                key={candidate.person.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <Link
                    to={`/admin/candidates/${candidate.person.id}?campaign_id=${campaign.id}`}
                    className="text-sm font-medium text-ink hover:text-accent"
                  >
                    {candidate.person.full_name}
                  </Link>
                  <p className="truncate text-xs text-ink-faint">
                    {candidate.person.headline ?? candidate.person.job_title ?? '—'}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ScorePill score={candidate.match_score} />
                  {candidate.workflow && <StatusBadge status={candidate.workflow.state} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {campaign.exclusions.length > 0 && (
        <Card title="Exclusions">
          <TagList
            values={campaign.exclusions.map((item) => `${item.exclusion_type}: ${item.value}`)}
          />
        </Card>
      )}

      {criteria && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">Criteria</h2>
            {isRunning ? (
              <span className="text-xs text-ink-faint">
                Pause the campaign to edit criteria — in-flight workflows must not switch rules mid-run.
              </span>
            ) : (
              draftCriteria && (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    loading={saveCriteria.isPending}
                    onClick={() => saveCriteria.mutate(draftCriteria)}
                  >
                    Save changes
                  </Button>
                  <Button variant="ghost" onClick={() => setDraftCriteria(null)}>
                    Discard
                  </Button>
                </div>
              )
            )}
          </div>

          {isRunning ? (
            <ReadOnlyCriteria criteria={criteria} />
          ) : (
            <CriteriaEditor criteria={criteria} onChange={setDraftCriteria} />
          )}

          {saveCriteria.isError && <ErrorState error={saveCriteria.error} />}
        </>
      )}
    </>
  )
}

function ReadOnlyCriteria({ criteria }: { criteria: Criteria }) {
  const rows: [string, string[]][] = [
    ['Job titles', criteria.job_titles],
    ['Industries', criteria.industries],
    ['Locations', criteria.locations],
    ['Include topics', criteria.include_topics],
    ['Exclude topics', criteria.exclude_topics],
  ]
  return (
    <Card className="p-4">
      <dl className="grid gap-4 sm:grid-cols-2">
        {rows.map(([label, values]) => (
          <div key={label}>
            <dt className="mb-1.5 text-xs font-medium text-ink-muted">{label}</dt>
            <dd>
              <TagList values={values} />
            </dd>
          </div>
        ))}
        <div>
          <dt className="mb-1.5 text-xs font-medium text-ink-muted">Thresholds</dt>
          <dd className="tabular text-sm text-ink">
            Candidate ≥ {criteria.minimum_candidate_score} · Post ≥{' '}
            {criteria.minimum_relevance_score}
          </dd>
        </div>
        <div>
          <dt className="mb-1.5 text-xs font-medium text-ink-muted">Workflow</dt>
          <dd className="tabular text-sm text-ink">
            Like {criteria.initial_posts_to_like}, evaluate post{' '}
            {criteria.evaluate_post_index}, connect after {criteria.connection_delay_hours}h
          </dd>
        </div>
      </dl>
    </Card>
  )
}
