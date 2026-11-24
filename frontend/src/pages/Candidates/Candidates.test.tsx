import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Candidates } from '@/pages/Candidates/Candidates'
import { emptyPage, mockFetch, renderWithProviders } from '@/test/utils'

const CANDIDATE = {
  person: {
    id: 3,
    full_name: 'Ananya Rao',
    headline: 'CTO at Finflow · Scaling Java platforms',
    job_title: 'CTO',
    company: 'Finflow',
    industry: 'SaaS',
    location: 'Bengaluru, India',
    profile_url: 'https://mock.local/in/mock-p-001',
    avatar_url: null,
    connection_status: 'NOT_CONNECTED',
    last_activity_at: null,
  },
  campaign_id: 1,
  match_score: 91,
  matched_criteria: ['CTO', 'SaaS', 'India'],
  discovery_reason: 'Matched 3 criteria',
  workflow: {
    id: 9,
    campaign_id: 1,
    person_id: 3,
    state: 'POST_3_EVALUATING',
    previous_state: 'POST_2_LIKED',
    context: {},
    consecutive_failures: 0,
    last_error_code: null,
    last_error_message: null,
    started_at: new Date().toISOString(),
    completed_at: null,
    updated_at: new Date().toISOString(),
  },
  next_action: 'Analyzing post #3',
}

describe('Candidates', () => {
  it('lists candidates with score, state and next action', async () => {
    mockFetch([
      {
        match: '/candidates',
        response: { items: [CANDIDATE], total: 1, page: 1, page_size: 100 },
      },
    ])

    renderWithProviders(<Candidates />)

    expect(await screen.findByRole('link', { name: 'Ananya Rao' })).toBeInTheDocument()
    expect(screen.getByText('Finflow')).toBeInTheDocument()
    expect(screen.getByText('91/100')).toBeInTheDocument()
    expect(screen.getByText('POST 3 EVALUATING')).toBeInTheDocument()
    expect(screen.getByText('Analyzing post #3')).toBeInTheDocument()
  })

  it('shows an empty state before discovery has run', async () => {
    mockFetch([{ match: '/candidates', response: emptyPage }])
    renderWithProviders(<Candidates />)

    expect(await screen.findByText(/No candidates/i)).toBeInTheDocument()
    expect(screen.getByText(/Start or run a campaign/i)).toBeInTheDocument()
  })
})
