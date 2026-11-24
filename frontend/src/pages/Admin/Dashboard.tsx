import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Stat,
  StatusBadge,
} from '@/components/ui'
import { useActivityStream } from '@/hooks/useActivityStream'
import { dashboardApi } from '@/services/api'
import { formatRelative } from '@/utils/format'

export function AdminDashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.get,
    refetchInterval: 10_000,
  })

  // Live events invalidate the dashboard query, so counters follow the agent.
  useActivityStream()

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  const { counters, agent, campaigns, recent_activity: activity } = data

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Everything the agent has done, and what it is doing right now."
        action={
          <Link
            to="/admin/campaigns/new"
            className="inline-flex items-center rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            + Create Campaign
          </Link>
        }
      />

      <Card
        title="Agent status"
        action={
          agent.dry_run ? <Badge tone="caution">DRY RUN</Badge> : <Badge tone="positive">LIVE</Badge>
        }
      >
        {agent.state === 'IDLE' ? (
          <p className="text-sm text-ink-muted">
            Idle — no campaign is running. Start one to put the agent to work.
          </p>
        ) : (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-medium text-ink-muted">State</dt>
              <dd className="mt-1">
                <StatusBadge status={agent.state} />
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Campaign</dt>
              <dd className="mt-1 text-sm font-medium text-ink">
                {agent.campaign_id ? (
                  <Link className="hover:text-accent" to={`/admin/campaigns/${agent.campaign_id}`}>
                    {agent.campaign_name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Current candidate</dt>
              <dd className="mt-1 text-sm font-medium text-ink">
                {agent.person_id ? (
                  <Link className="hover:text-accent" to={`/admin/candidates/${agent.person_id}`}>
                    {agent.person_name}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-ink-muted">Current step</dt>
              <dd className="mt-1 text-sm font-medium text-ink">{agent.current_step ?? '—'}</dd>
            </div>
          </dl>
        )}
      </Card>

      <section aria-label="Counters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active campaigns" value={counters.active_campaigns} />
        <Stat label="Actions today" value={counters.actions_today} />
        <Stat
          label="Pending approvals"
          value={counters.pending_approvals}
          hint={counters.pending_approvals > 0 ? 'Waiting on you' : undefined}
        />
        <Stat label="Failed actions" value={counters.failed_actions} />

        <Stat label="Candidates found" value={counters.candidates_discovered} />
        <Stat label="Candidates matched" value={counters.candidates_matched} />
        <Stat label="Candidates processed" value={counters.candidates_processed} />
        <Stat label="Posts analyzed" value={counters.posts_analyzed} />

        <Stat label="Posts liked" value={counters.posts_liked} />
        <Stat label="Comments generated" value={counters.comments_generated} />
        <Stat label="Comments posted" value={counters.comments_posted} />
        <Stat label="Connections sent" value={counters.connections_sent} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Campaigns in flight"
          action={
            <Link className="text-xs font-medium text-accent hover:underline" to="/admin/campaigns">
              View all
            </Link>
          }
        >
          {campaigns.length === 0 ? (
            <EmptyState
              title="No active campaigns"
              description="Create a campaign and start it to see live progress here."
              action={
                <Link
                  to="/admin/campaigns/new"
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Create Campaign
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/campaigns/${campaign.id}`}
                      className="block truncate text-sm font-medium text-ink hover:text-accent"
                    >
                      {campaign.name}
                    </Link>
                    <p className="tabular mt-0.5 text-xs text-ink-faint">
                      {campaign.candidates_processed} processed
                      {campaign.pending_approvals > 0 &&
                        ` · ${campaign.pending_approvals} awaiting approval`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {campaign.dry_run && <Badge tone="caution">DRY</Badge>}
                    <StatusBadge status={campaign.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent activity"
          action={
            <Link className="text-xs font-medium text-accent hover:underline" to="/admin/activity">
              View all
            </Link>
          }
        >
          {activity.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <ul className="space-y-2.5">
              {[...activity].reverse().map((entry) => (
                <li key={entry.id} className="flex gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className={
                      entry.level === 'ERROR'
                        ? 'mt-1.5 size-1.5 shrink-0 rounded-full bg-critical'
                        : entry.level === 'WARNING'
                          ? 'mt-1.5 size-1.5 shrink-0 rounded-full bg-caution'
                          : 'mt-1.5 size-1.5 shrink-0 rounded-full bg-accent'
                    }
                  />
                  <div className="min-w-0">
                    <p className="text-ink">{entry.message}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {formatRelative(entry.created_at)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
