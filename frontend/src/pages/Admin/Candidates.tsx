import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  ScorePill,
  StatusBadge,
} from '@/components/ui'
import { candidatesApi } from '@/services/api'

export function AdminCandidates() {
  const [params] = useSearchParams()
  const campaignId = params.get('campaign_id') ? Number(params.get('campaign_id')) : undefined
  const [search, setSearch] = useState('')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['candidates', { campaignId, search }],
    queryFn: () =>
      candidatesApi.list({
        campaign_id: campaignId,
        search: search.trim() || undefined,
        page_size: 100,
      }),
  })

  return (
    <>
      <PageHeader
        title="Candidates"
        description="Everyone the agent has discovered, with the score and reasoning behind each decision."
      />

      <Card>
        <Input
          value={search}
          placeholder="Search by name or company"
          aria-label="Search candidates"
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="mt-4">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : !data?.items.length ? (
            <EmptyState
              title="No candidates found"
              description={
                search
                  ? 'Nothing matches that search.'
                  : 'Start a campaign and the agent will populate this list.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-3xl text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs text-ink-muted">
                    <th className="pb-2 font-medium">Name</th>
                    <th className="pb-2 font-medium">Company</th>
                    <th className="pb-2 font-medium">Location</th>
                    <th className="pb-2 font-medium">Score</th>
                    <th className="pb-2 font-medium">State</th>
                    <th className="pb-2 font-medium">Next action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {data.items.map((candidate) => (
                    <tr key={`${candidate.campaign_id}-${candidate.person.id}`}>
                      <td className="py-2.5 pr-3">
                        <Link
                          to={`/admin/candidates/${candidate.person.id}?campaign_id=${candidate.campaign_id}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {candidate.person.full_name}
                        </Link>
                        <p className="max-w-xs truncate text-xs text-ink-faint">
                          {candidate.person.headline ?? '—'}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 text-ink-muted">
                        {candidate.person.company ?? '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-ink-muted">
                        {candidate.person.location ?? '—'}
                      </td>
                      <td className="py-2.5 pr-3">
                        <ScorePill score={candidate.match_score} />
                      </td>
                      <td className="py-2.5 pr-3">
                        {candidate.workflow ? (
                          <StatusBadge status={candidate.workflow.state} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2.5 text-xs text-ink-muted">
                        {candidate.next_action ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </>
  )
}
