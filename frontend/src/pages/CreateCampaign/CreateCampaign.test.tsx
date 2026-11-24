import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { CreateCampaign } from '@/pages/CreateCampaign/CreateCampaign'
import { defaultCriteria, mockFetch, renderWithProviders } from '@/test/utils'

const INSTRUCTION =
  'Find CTOs in SaaS companies in India who post about Java, AI and microservices.'

const ANALYZE_RESPONSE = {
  parsed: {},
  criteria: defaultCriteria,
  suggested_name: 'Java + AI CTO Outreach',
  summary: 'Targets engineering leaders in Indian SaaS companies who post about Java and AI.',
  provider: 'mock',
  model: 'mock-model',
  prompt_version: 'v1',
}

describe('CreateCampaign', () => {
  it('analyzes the instruction and shows the parsed criteria for review', async () => {
    const user = userEvent.setup()
    mockFetch([{ match: '/campaigns/analyze', method: 'POST', response: ANALYZE_RESPONSE }])

    renderWithProviders(<CreateCampaign />)

    await user.type(screen.getByLabelText('Campaign instruction'), INSTRUCTION)
    await user.click(screen.getByRole('button', { name: 'Analyze Requirements' }))

    expect(await screen.findByText(ANALYZE_RESPONSE.summary)).toBeInTheDocument()
    expect(screen.getByDisplayValue('Java + AI CTO Outreach')).toBeInTheDocument()

    // Every parsed criterion is visible and editable.
    expect(screen.getByText('CTO')).toBeInTheDocument()
    expect(screen.getByText('SaaS')).toBeInTheDocument()
    expect(screen.getByText('India')).toBeInTheDocument()
    expect(screen.getByText('Recruitment')).toBeInTheDocument()

    expect(screen.getByText(/Parsed by mock/)).toBeInTheDocument()
  })

  it('keeps the analyze button disabled until there is an instruction', async () => {
    mockFetch([])
    renderWithProviders(<CreateCampaign />)
    expect(screen.getByRole('button', { name: 'Analyze Requirements' })).toBeDisabled()
  })

  it('lets the user edit criteria before saving, and sends the edits', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch([
      { match: '/campaigns/analyze', method: 'POST', response: ANALYZE_RESPONSE },
      { match: /\/campaigns$/, method: 'POST', response: { id: 7, name: 'x' } },
    ])

    renderWithProviders(<CreateCampaign />)
    await user.type(screen.getByLabelText('Campaign instruction'), INSTRUCTION)
    await user.click(screen.getByRole('button', { name: 'Analyze Requirements' }))
    await screen.findByDisplayValue('Java + AI CTO Outreach')

    // Remove a job title the parser proposed and add one of our own.
    await user.click(screen.getByRole('button', { name: 'Remove CTO' }))
    await user.type(screen.getByLabelText('Add to Job titles'), 'Principal Engineer{Enter}')

    await user.click(screen.getByRole('button', { name: 'Save Draft' }))

    await waitFor(() => {
      const create = calls.find((call) => call.method === 'POST' && call.url.endsWith('/campaigns'))
      expect(create).toBeDefined()
      const body = create!.body as { criteria: typeof defaultCriteria }
      expect(body.criteria.job_titles).toEqual(['Principal Engineer'])
    })
  })

  it('starts the campaign when the user chooses Start Campaign', async () => {
    const user = userEvent.setup()
    const { calls } = mockFetch([
      { match: '/campaigns/analyze', method: 'POST', response: ANALYZE_RESPONSE },
      { match: /\/campaigns$/, method: 'POST', response: { id: 11, name: 'x' } },
      { match: '/campaigns/11/start', method: 'POST', response: { campaign: {}, message: 'ok' } },
    ])

    renderWithProviders(<CreateCampaign />)
    await user.type(screen.getByLabelText('Campaign instruction'), INSTRUCTION)
    await user.click(screen.getByRole('button', { name: 'Analyze Requirements' }))
    await screen.findByDisplayValue('Java + AI CTO Outreach')

    await user.click(screen.getByRole('button', { name: 'Start Campaign' }))

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/campaigns/11/start'))).toBe(true)
    })
  })

  it('defaults to dry run so nothing reaches the platform by accident', async () => {
    const user = userEvent.setup()
    mockFetch([{ match: '/campaigns/analyze', method: 'POST', response: ANALYZE_RESPONSE }])

    renderWithProviders(<CreateCampaign />)
    await user.type(screen.getByLabelText('Campaign instruction'), INSTRUCTION)
    await user.click(screen.getByRole('button', { name: 'Analyze Requirements' }))

    const dryRun = await screen.findByRole('checkbox', { name: /Dry run/ })
    expect(dryRun).toBeChecked()
    expect(screen.getByText('Nothing is sent to the platform')).toBeInTheDocument()
  })

  it('surfaces a parser failure instead of silently continuing', async () => {
    const user = userEvent.setup()
    mockFetch([
      {
        match: '/campaigns/analyze',
        method: 'POST',
        status: 502,
        response: {
          code: 'AI_INVALID_RESPONSE',
          message: 'The model did not return valid criteria.',
          details: {},
        },
      },
    ])

    renderWithProviders(<CreateCampaign />)
    await user.type(screen.getByLabelText('Campaign instruction'), INSTRUCTION)
    await user.click(screen.getByRole('button', { name: 'Analyze Requirements' }))

    expect(await screen.findByText('The model did not return valid criteria.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start Campaign' })).not.toBeInTheDocument()
  })
})
