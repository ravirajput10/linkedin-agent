import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { campaignsApi } from '@/services/api'
import type { Campaign } from '@/types/api'
import { formatDateTime } from '@/utils/format'

function AdminCampaignRow({ campaign }: { campaign: Campaign }) {
  const queryClient = useQueryClient()

  const start = useLifecycleMutation('start', campaign.id, queryClient)
  const pause = useLifecycleMutation('pause', campaign.id, queryClient)
  const resume = useLifecycleMutation('resume', campaign.id, queryClient)
  const stop = useLifecycleMutation('stop', campaign.id, queryClient)

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/admin/campaigns/${campaign.id}`}
            className="truncate text-sm font-medium text-ink hover:text-accent"
          >
            {campaign.name}
          </Link>
          <StatusBadge status={campaign.status} />
          {campaign.dry_run && <Badge tone="caution">DRY RUN</Badge>}
        </div>
        <p className="mt-0.5 line-clamp-1 text-xs text-ink-faint">{campaign.instruction}</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          Created {formatDateTime(campaign.created_at)}
        </p>
      </div>

      <div className="flex shrink-0 gap-2">
        {campaign.status === 'DRAFT' && (
          <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
            Start
          </Button>
        )}
        {campaign.status === 'RUNNING' && (
          <>
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
    </li>
  )
}

function useLifecycleMutation(
  action: 'start' | 'pause' | 'resume' | 'stop',
  campaignId: number,
  queryClient: ReturnType<typeof useQueryClient>,
) {
  return useMutation({
    mutationFn: () => campaignsApi[action](campaignId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function AdminCampaigns() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list({ page_size: 100 }),
  })

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Target profiles and automated outreach sequences."
        action={
          <Link to="/admin/campaigns/new">
            <Button variant="primary">New campaign</Button>
          </Link>
        }
      />

      <Card className="p-4">
        {!data.items.length ? (
          <EmptyState
            title="No campaigns yet"
            description="Create your first campaign to define who to target and what sequence to run."
            action={
              <Link to="/admin/campaigns/new">
                <Button variant="primary">Create campaign</Button>
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {data.items.map((campaign) => (
              <AdminCampaignRow key={campaign.id} campaign={campaign} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
