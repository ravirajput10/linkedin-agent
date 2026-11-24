import { useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Stat,
} from '@/components/ui'
import { dashboardApi } from '@/services/api'
import { formatDate } from '@/utils/format'

const SERIES_COLORS = {
  likes: '#2563eb',
  comments: '#7c3aed',
  connections: '#15803d',
  failures: '#b91c1c',
}

const AXIS_STYLE = { fontSize: 12, fill: '#5c6472' }

export function AdminAnalytics() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics'],
    queryFn: () => dashboardApi.analytics({ days: 14 }),
    refetchInterval: 60_000,
  })

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  const hasActivity = data.time_series.some(
    (point) => point.likes + point.comments + point.connections > 0,
  )

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Only what the system actually recorded. Nothing is inferred about what happened after an action left the app."
      />

      <section aria-label="AI usage" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="AI requests today" value={data.ai.requests_today} />
        <Stat label="AI requests total" value={data.ai.requests_total} />
        <Stat
          label="Estimated cost"
          value={`$${data.ai.estimated_cost_usd.toFixed(4)}`}
          hint="Local models cost nothing"
        />
        <Stat label="Average latency" value={`${data.ai.average_latency_ms} ms`} />
        <Stat label="GPU seconds" value={data.ai.gpu_seconds.toFixed(1)} />
        <Stat
          label="AI failure rate"
          value={`${(data.ai.failure_rate * 100).toFixed(1)}%`}
        />
        <Stat
          label="Average processing"
          value={
            data.average_processing_seconds === null
              ? '—'
              : `${Math.round(data.average_processing_seconds)}s`
          }
          hint="Discovery to completion"
        />
        <Stat
          label="Requests by provider"
          value={
            Object.entries(data.ai.by_provider)
              .map(([provider, count]) => `${provider}: ${count}`)
              .join(' · ') || '—'
          }
        />
      </section>

      <Card title="Funnel">
        {data.funnel.every((point) => point.value === 0) ? (
          <EmptyState title="No data yet" description="Run a campaign to populate the funnel." />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.funnel} layout="vertical" margin={{ left: 40, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e5ea" horizontal={false} />
                <XAxis type="number" tick={AXIS_STYLE} allowDecimals={false} />
                <YAxis type="category" dataKey="label" width={150} tick={AXIS_STYLE} />
                <Tooltip cursor={{ fill: '#f6f7f9' }} />
                <Bar dataKey="value" fill={SERIES_COLORS.likes} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Card title="Actions over the last 14 days">
        {!hasActivity ? (
          <EmptyState title="No actions recorded yet" />
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={data.time_series.map((point) => ({ ...point, label: formatDate(point.day) }))}
                margin={{ left: 8, right: 16, top: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e5ea" />
                <XAxis dataKey="label" tick={AXIS_STYLE} />
                <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="likes" stroke={SERIES_COLORS.likes} strokeWidth={2} dot={false} />
                <Line
                  type="monotone"
                  dataKey="comments"
                  stroke={SERIES_COLORS.comments}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="connections"
                  stroke={SERIES_COLORS.connections}
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="failures"
                  stroke={SERIES_COLORS.failures}
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {data.top_topics.length > 0 && (
        <Card title="Most common topics in accepted posts">
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.top_topics} margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e5ea" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_STYLE} />
                <YAxis tick={AXIS_STYLE} allowDecimals={false} />
                <Tooltip cursor={{ fill: '#f6f7f9' }} />
                <Bar dataKey="value" fill={SERIES_COLORS.comments} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </>
  )
}
