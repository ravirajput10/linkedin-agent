import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dashboard } from '@/pages/Dashboard/Dashboard'
import { mockFetch, renderWithProviders } from '@/test/utils'

const COUNTERS = {
  active_campaigns: 3,
  candidates_discovered: 127,
  candidates_matched: 43,
  candidates_processed: 31,
  posts_analyzed: 112,
  posts_liked: 62,
  comments_generated: 24,
  comments_posted: 18,
  connections_scheduled: 19,
  connections_sent: 11,
  failed_actions: 2,
  actions_today: 19,
  pending_approvals: 4,
}

const RUNNING_AGENT = {
  state: 'RUNNING',
  campaign_id: 1,
  campaign_name: 'Java + AI CTO Outreach',
  person_id: 5,
  person_name: 'John Smith',
  workflow_state: 'POST_3_EVALUATING',
  current_step: 'Analyzing post #3',
  dry_run: true,
  updated_at: new Date().toISOString(),
}

function stubDashboard(overrides: Record<string, unknown> = {}) {
  return mockFetch([
    { match: '/approvals/counts', response: { CANDIDATE: 0, COMMENT: 4, CONNECTION: 0 } },
    {
      match: '/dashboard',
      response: {
        counters: COUNTERS,
        agent: RUNNING_AGENT,
        campaigns: [
          {
            id: 1,
            name: 'Java + AI CTO Outreach',
            status: 'RUNNING',
            dry_run: true,
            candidates_processed: 31,
            pending_approvals: 4,
          },
        ],
        recent_activity: [
          {
            id: 1,
            campaign_id: 1,
            person_id: 5,
            workflow_id: 9,
            level: 'INFO',
            event_type: 'post_evaluated',
            message: 'Post scored 93/100 for John Smith',
            payload: null,
            created_at: new Date().toISOString(),
          },
        ],
        ...overrides,
      },
    },
  ])
}

describe('Dashboard', () => {
  it('shows the new KPI cards and metrics', async () => {
    stubDashboard()
    renderWithProviders(<Dashboard />)

    expect(await screen.findByText('PROSPECTS ENGAGED')).toBeInTheDocument()
    expect(screen.getByText('CONNECTION REQUESTS')).toBeInTheDocument()
    expect(screen.getByText('AI COMMENTS POSTED')).toBeInTheDocument()
    expect(screen.getByText('YOUR POSTS PUBLISHED')).toBeInTheDocument()
  })

  it('shows the dashboard sections', async () => {
    stubDashboard()
    renderWithProviders(<Dashboard />)

    expect(await screen.findByText('Engagement funnel')).toBeInTheDocument()
    expect(screen.getByText('Needs your approval')).toBeInTheDocument()
    expect(screen.getByText('Active campaigns')).toBeInTheDocument()
    expect(screen.getByText('Today’s safety limits')).toBeInTheDocument()
    expect(screen.getByText('Recent activity')).toBeInTheDocument()
  })

  it('shows greeting and agent status controls', async () => {
    stubDashboard()
    renderWithProviders(<Dashboard />)

    expect(await screen.findByText(/Good morning/i)).toBeInTheDocument()
    expect(screen.getByText(/Agent:/i)).toBeInTheDocument()
    expect(screen.getByText('Pause all')).toBeInTheDocument()
    expect(screen.getByText('New campaign')).toBeInTheDocument()
  })

  it('surfaces a backend failure rather than rendering blank', async () => {
    mockFetch([
      { match: '/approvals/counts', response: {} },
      {
        match: '/dashboard',
        status: 500,
        response: { code: 'INTERNAL_ERROR', message: 'Database unavailable.', details: {} },
      },
    ])

    renderWithProviders(<Dashboard />)
    expect(await screen.findByText('Database unavailable.')).toBeInTheDocument()
  })
})

