import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ScheduledActions } from '@/pages/ScheduledActions/ScheduledActions'
import { emptyPage, mockFetch, renderWithProviders } from '@/test/utils'

const IN_TWO_DAYS = new Date(Date.now() + 48 * 3600 * 1000).toISOString()

const ACTION = {
  id: 12,
  campaign_id: 1,
  person_id: 3,
  workflow_id: 9,
  task_type: 'CONNECTION',
  status: 'SCHEDULED',
  scheduled_at: IN_TWO_DAYS,
  executed_at: null,
  attempt_count: 0,
  error_code: null,
  error_message: null,
  created_at: new Date().toISOString(),
  campaign_name: 'Java + AI CTO Outreach',
  person: {
    id: 3,
    full_name: 'Ananya Rao',
    headline: 'CTO at Finflow',
    job_title: 'CTO',
    company: 'Finflow',
    industry: 'SaaS',
    location: 'Bengaluru, India',
    profile_url: 'https://mock.local/in/mock-p-001',
    avatar_url: null,
    connection_status: 'NOT_CONNECTED',
    last_activity_at: null,
  },
}

function stub(extra: Parameters<typeof mockFetch>[0] = []) {
  return mockFetch([
    { match: '/scheduled-actions', response: { items: [ACTION], total: 1, page: 1, page_size: 100 } },
    ...extra,
  ])
}

describe('ScheduledActions', () => {
  it('shows the pending connection with its due time', async () => {
    stub()
    renderWithProviders(<ScheduledActions />)

    expect(await screen.findByText('Ananya Rao')).toBeInTheDocument()
    expect(screen.getByText('SCHEDULED')).toBeInTheDocument()
    expect(screen.getByText(/Java \+ AI CTO Outreach/)).toBeInTheDocument()
  })

  it('cancels a scheduled action', async () => {
    const user = userEvent.setup()
    const { calls } = stub([
      { match: '/scheduled-actions/12/cancel', method: 'POST', response: ACTION },
    ])

    renderWithProviders(<ScheduledActions />)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/scheduled-actions/12/cancel'))).toBe(true)
    })
  })

  it('reschedules to a new time', async () => {
    const user = userEvent.setup()
    const { calls } = stub([
      { match: '/scheduled-actions/12/reschedule', method: 'POST', response: ACTION },
    ])

    renderWithProviders(<ScheduledActions />)
    await user.click(await screen.findByRole('button', { name: 'Reschedule' }))

    const input = screen.getByLabelText('New scheduled time')
    await user.clear(input)
    await user.type(input, '2030-01-01T10:00')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes('/reschedule'))
      expect(call).toBeDefined()
      expect((call!.body as { scheduled_at: string }).scheduled_at).toContain('2030')
    })
  })

  it('runs an action immediately', async () => {
    const user = userEvent.setup()
    const { calls } = stub([
      { match: '/scheduled-actions/12/run-now', method: 'POST', response: ACTION },
    ])

    renderWithProviders(<ScheduledActions />)
    await user.click(await screen.findByRole('button', { name: 'Run now' }))

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/run-now'))).toBe(true)
    })
  })

  it('explains the empty state', async () => {
    mockFetch([{ match: '/scheduled-actions', response: emptyPage }])
    renderWithProviders(<ScheduledActions />)
    expect(await screen.findByText('Nothing scheduled')).toBeInTheDocument()
  })
})
