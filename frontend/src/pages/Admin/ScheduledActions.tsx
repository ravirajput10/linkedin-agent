import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui'
import { scheduledActionsApi } from '@/services/api'
import type { ScheduledAction } from '@/types/api'
import { formatDateTime, formatRelative, toLocalInputValue } from '@/utils/format'

export function AdminScheduledActions() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['scheduled-actions'],
    queryFn: () => scheduledActionsApi.list({ page_size: 100 }),
    refetchInterval: 30_000,
  })

  return (
    <>
      <PageHeader
        title="Scheduled actions"
        description="Delayed jobs live in the database, so they survive restarts. Each one revalidates before it runs."
      />

      <Card>
        {isLoading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data?.items.length ? (
          <EmptyState
            title="Nothing scheduled"
            description="Connection requests are scheduled once the engagement sequence completes."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {data.items.map((action) => (
              <AdminScheduledRow key={action.id} action={action} />
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}

function AdminScheduledRow({ action }: { action: ScheduledAction }) {
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

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {action.person ? (
              <Link
                to={`/admin/candidates/${action.person.id}?campaign_id=${action.campaign_id}`}
                className="text-sm font-medium text-ink hover:text-accent"
              >
                {action.person.full_name}
              </Link>
            ) : (
              <span className="text-sm font-medium text-ink">—</span>
            )}
            <StatusBadge status={action.status} />
            <span className="text-xs text-ink-faint">{action.task_type}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-faint">
            {action.campaign_name} · due {formatDateTime(action.scheduled_at)} (
            {formatRelative(action.scheduled_at)})
          </p>
          {action.error_message && (
            <p className="mt-1 text-xs text-critical">{action.error_message}</p>
          )}
        </div>

        {isOpen && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button loading={runNow.isPending} onClick={() => runNow.mutate()}>
              Run now
            </Button>
            <Button onClick={() => setRescheduling((value) => !value)}>Reschedule</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel
            </Button>
          </div>
        )}
      </div>

      {rescheduling && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="w-56">
            <Input
              type="datetime-local"
              value={when}
              aria-label="New scheduled time"
              onChange={(event) => setWhen(event.target.value)}
            />
          </div>
          <Button variant="primary" loading={reschedule.isPending} onClick={() => reschedule.mutate()}>
            Save
          </Button>
          {reschedule.isError && (
            <span className="text-xs text-critical">
              {(reschedule.error as Error).message}
            </span>
          )}
        </div>
      )}
    </li>
  )
}
