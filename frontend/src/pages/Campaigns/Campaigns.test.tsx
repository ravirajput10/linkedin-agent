import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Campaigns } from '@/pages/Campaigns/Campaigns'
import { emptyPage, mockFetch, renderWithProviders } from '@/test/utils'

function campaign(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Java + AI CTO Outreach',
    description: null,
    instruction: 'Find CTOs in SaaS companies in India.',
    status: 'RUNNING',
    dry_run: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    started_at: null,
    completed_at: null,
    last_error: null,
    criteria: {
      job_titles: ['CTO', 'VP Engineering'],
      initial_posts_to_like: 2,
      max_people_per_day: 15,
    },
    exclusions: [],
    ...overrides,
  }
}

function stub(items: ReturnType<typeof campaign>[], extra: Parameters<typeof mockFetch>[0] = []) {
  return mockFetch([
    { match: /\/campaigns\?/, response: { items, total: items.length, page: 1, page_size: 100 } },
    ...extra,
  ])
}

describe('Campaigns', () => {
  it('lists campaigns with name, audience, progress, and status badge', async () => {
    stub([campaign({ status: 'RUNNING' })])
    renderWithProviders(<Campaigns />)

    expect(await screen.findByText('Java + AI CTO Outreach')).toBeInTheDocument()
    expect(screen.getByText(/CTO, VP Engineering/i)).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Java \+ AI CTO Outreach/i })).toHaveAttribute('href', '/campaigns/1')
  })

  it('switches to sequence templates tab when clicked', async () => {
    const user = userEvent.setup()
    stub([campaign()])
    renderWithProviders(<Campaigns />)

    const templatesTab = await screen.findByRole('button', { name: /Sequence templates/i })
    await user.click(templatesTab)

    expect(await screen.findByText(/Founder & Executive/i)).toBeInTheDocument()
    expect(screen.getByText(/Technical Talent/i)).toBeInTheDocument()
  })

  it('guides the user to create a campaign when the list is empty', async () => {
    mockFetch([{ match: /\/campaigns\?/, response: emptyPage }])
    renderWithProviders(<Campaigns />)

    expect(await screen.findByText('No campaigns created yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create Campaign/i })).toBeInTheDocument()
  })
})
