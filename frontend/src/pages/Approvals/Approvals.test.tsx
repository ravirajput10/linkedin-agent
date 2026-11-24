import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Approvals } from '@/pages/Approvals/Approvals'
import { emptyPage, mockFetch, renderWithProviders } from '@/test/utils'

const PERSON = {
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
}

const APPROVAL = {
  id: 42,
  campaign_id: 1,
  person_id: 3,
  workflow_id: 9,
  post_id: 5,
  comment_id: 8,
  connection_message_id: null,
  approval_type: 'COMMENT',
  status: 'PENDING',
  proposed_action: 'POST_COMMENT',
  ai_reasoning: 'Directly discusses partitioning trade-offs.',
  ai_score: null,
  content: 'The locking point is the part most teams miss.',
  context: null,
  decided_at: null,
  decided_by: null,
  created_at: new Date().toISOString(),
  person: PERSON,
  campaign_name: 'Java + AI CTO Outreach',
  post: {
    id: 5,
    person_id: 3,
    campaign_id: 1,
    external_id: 'mock-post-001-a',
    post_url: 'https://mock.local/posts/mock-post-001-a',
    content: 'We moved settlement onto Kafka with per-tenant partitions.',
    post_type: 'TEXT',
    published_at: new Date().toISOString(),
    like_count: 214,
    comment_count: 31,
    sequence_index: 3,
    is_eligible: true,
    ineligibility_reason: null,
    processing_status: 'LIKED',
    created_at: new Date().toISOString(),
  },
  post_evaluation: {
    id: 2,
    eligible: true,
    relevance_score: 91,
    topics: ['Java', 'Kafka'],
    reason: 'Directly discusses partitioning trade-offs.',
    risk_flags: [],
    agent_name: 'post_evaluator',
    prompt_version: 'v1',
    provider: 'mock',
    model: 'mock-model',
    created_at: new Date().toISOString(),
  },
}

function stub(overrides: Record<string, unknown> = {}, extra: Parameters<typeof mockFetch>[0] = []) {
  return mockFetch([
    { match: '/content-studio/posts', response: [] },
    {
      match: /\/approvals\?/,
      response: { items: [{ ...APPROVAL, ...overrides }], total: 1, page: 1, page_size: 50 },
    },
    ...extra,
  ])
}

describe('Approvals', () => {
  it('shows the post, the AI evaluation reason and the suggested draft', async () => {
    stub()
    renderWithProviders(<Approvals />)

    expect((await screen.findAllByText(/Ananya Rao/)).length).toBeGreaterThan(0)
    expect(screen.getByText(/We moved settlement onto Kafka/)).toBeInTheDocument()
    expect(screen.getByText(/Directly discusses partitioning trade-offs/)).toBeInTheDocument()
    expect(screen.getByText('#Java')).toBeInTheDocument()
    expect(screen.getByDisplayValue(APPROVAL.content)).toBeInTheDocument()
  })

  it('approves without edits by default', async () => {
    const user = userEvent.setup()
    const { calls } = stub({}, [
      { match: '/approvals/42/approve', method: 'POST', response: APPROVAL },
    ])

    renderWithProviders(<Approvals />)
    const approveBtn = await screen.findByRole('button', { name: /^Approve &/ })
    await user.click(approveBtn)

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes('/approvals/42/approve'))
      expect(call).toBeDefined()
    })
  })

  it('sends the edited text when the user edits before approving', async () => {
    const user = userEvent.setup()
    const { calls } = stub({}, [
      { match: '/approvals/42/approve', method: 'POST', response: APPROVAL },
    ])

    renderWithProviders(<Approvals />)
    const editor = await screen.findByDisplayValue(APPROVAL.content)
    await user.clear(editor)
    await user.type(editor, 'A sharper, human-edited observation.')
    await user.click(screen.getByRole('button', { name: /^Approve &/ }))

    await waitFor(() => {
      const call = calls.find((c) => c.url.includes('/approvals/42/approve'))
      expect(call).toBeDefined()
      expect(call!.body).toEqual({ edited_content: 'A sharper, human-edited observation.' })
    })
  })

  it('rejects an approval', async () => {
    const user = userEvent.setup()
    const { calls } = stub({}, [
      { match: '/approvals/42/reject', method: 'POST', response: APPROVAL },
    ])

    renderWithProviders(<Approvals />)
    const rejectBtn = await screen.findByRole('button', { name: 'Reject' })
    await user.click(rejectBtn)

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/approvals/42/reject'))).toBe(true)
    })
  })

  it('regenerates and shows the new draft', async () => {
    const user = userEvent.setup()
    const { calls } = stub({}, [
      {
        match: '/approvals/42/regenerate',
        method: 'POST',
        response: { ...APPROVAL, content: 'A freshly generated observation about partitioning.' },
      },
    ])

    renderWithProviders(<Approvals />)
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }))

    expect(
      await screen.findByDisplayValue('A freshly generated observation about partitioning.'),
    ).toBeInTheDocument()
    expect(calls.some((c) => c.url.includes('/regenerate'))).toBe(true)
  })

  it('blocks approval of an over-length connection note', async () => {
    const user = userEvent.setup()
    stub({
      approval_type: 'CONNECTION',
      proposed_action: 'SEND_CONNECTION',
      content: 'Hi Ananya, short note.',
      post: null,
      post_evaluation: null,
      comment_id: null,
      connection_message_id: 4,
    })

    renderWithProviders(<Approvals />)
    const editor = await screen.findByDisplayValue('Hi Ananya, short note.')
    await user.clear(editor)
    await user.paste('x'.repeat(301))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Approve &/ })).toBeDisabled()
    })
    expect(screen.getByText(/301 CHARACTERS \/ 300/)).toBeInTheDocument()
  })

  it('shows an empty state when nothing is waiting', async () => {
    mockFetch([
      { match: '/content-studio/posts', response: [] },
      { match: '/approvals/counts', response: { CANDIDATE: 0, COMMENT: 0, CONNECTION: 0 } },
      { match: /\/approvals\?/, response: emptyPage },
    ])

    renderWithProviders(<Approvals />)
    expect(await screen.findByText('Nothing waiting')).toBeInTheDocument()
  })

  it('switches between approval categories', async () => {
    const user = userEvent.setup()
    stub()
    renderWithProviders(<Approvals />)

    const commentsTab = await screen.findByRole('button', { name: /Comments/ })
    await user.click(commentsTab)
    await waitFor(() => {
      expect(commentsTab.className).toContain('text-[#2445C8]')
    })
  })
})
