import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '@/components/ui'
import { useActivityStream } from '@/hooks/useActivityStream'
import { activityApi } from '@/services/api'
import type { Activity as ActivityEntry, LogLevel } from '@/types/api'
import { formatDateTime, formatRelative } from '@/utils/format'

const LEVEL_STYLES: Record<LogLevel, string> = {
  DEBUG: 'bg-neutral-soft',
  INFO: 'bg-accent',
  WARNING: 'bg-caution',
  ERROR: 'bg-critical',
}

export function AdminActivity() {
  const [level, setLevel] = useState<LogLevel | ''>('')

  const history = useQuery({
    queryKey: ['activity', { level }],
    queryFn: () => activityApi.list({ level: level || undefined, page_size: 100 }),
  })

  const { events: live, connected } = useActivityStream()

  /** Live events prepend to history; the id set keeps duplicates out. */
  const entries = useMemo<ActivityEntry[]>(() => {
    const historical = history.data?.items ?? []
    const seen = new Set(historical.map((entry) => entry.id))
    const fresh = live.filter(
      (entry) => !seen.has(entry.id) && (!level || entry.level === level),
    )
    return [...fresh, ...historical]
  }, [history.data, live, level])

  return (
    <>
      <PageHeader
        title="Agent activity"
        description="Every decision the agent made, in order, with the reasoning attached."
        action={
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            <span
              aria-hidden
              className={clsx(
                'size-2 rounded-full',
                connected ? 'bg-positive' : 'bg-ink-faint',
              )}
            />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        }
      />

      <Card
        action={
          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as LogLevel | '')}
            aria-label="Filter by level"
            className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-ink"
          >
            <option value="">All levels</option>
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="ERROR">Error</option>
            <option value="DEBUG">Debug</option>
          </select>
        }
        title="Event log"
      >
        {history.isLoading ? (
          <LoadingState />
        ) : history.error ? (
          <ErrorState error={history.error} onRetry={() => history.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Start a campaign to see the agent work in real time."
          />
        ) : (
          <ul className="space-y-2.5">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span
                  aria-hidden
                  className={clsx('mt-1.5 size-1.5 shrink-0 rounded-full', LEVEL_STYLES[entry.level])}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-sm text-ink">{entry.message}</p>
                    <Badge>{entry.event_type}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-ink-faint" title={formatDateTime(entry.created_at)}>
                    {formatRelative(entry.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
