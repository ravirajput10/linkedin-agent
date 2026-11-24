import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { RequireAdmin } from '@/auth/guards'
import { AdminUsers } from '@/pages/Admin/Users'
import {
  makeAdminUser,
  makeUser,
  mockFetch,
  renderWithAuth,
  signInStorage,
} from '@/test/utils'

const STATS = {
  total_users: 2,
  active_users: 2,
  deactivated_users: 0,
  pending_verification: 0,
  admins: 1,
  new_users_last_7_days: 1,
  total_campaigns: 3,
  running_campaigns: 1,
}

const MEMBER = makeAdminUser({
  id: 1,
  email: 'owner@example.com',
  full_name: 'Owner Person',
  role: 'USER',
  campaign_count: 3,
  active_campaign_count: 1,
  candidate_count: 42,
})

const ADMIN = makeAdminUser({ id: 2 })

function usersPage(items = [MEMBER, ADMIN]) {
  return { items, total: items.length, page: 1, page_size: 25 }
}

function baseRoutes(signedInAs = makeUser({ id: 2, role: 'ADMIN' })) {
  return [
    { match: '/auth/me', response: signedInAs },
    { match: '/admin/stats', response: STATS },
    { match: '/admin/users', response: usersPage() },
  ]
}

describe('Admin users', () => {
  it('lists every account with its campaign activity', async () => {
    signInStorage()
    mockFetch(baseRoutes())

    renderWithAuth(<AdminUsers />)

    expect(await screen.findByText('Owner Person')).toBeInTheDocument()
    expect(screen.getByText('Admin Person')).toBeInTheDocument()

    const row = screen.getByText('Owner Person').closest('tr')!
    expect(within(row).getByText('42')).toBeInTheDocument()
    expect(within(row).getByText('(1 live)')).toBeInTheDocument()

    // The overview tiles come from /admin/stats, not from counting the page.
    expect(screen.getByText('Total users')).toBeInTheDocument()
  })

  it('deactivates a user and sends the reason', async () => {
    signInStorage()
    vi.spyOn(window, 'prompt').mockReturnValue('Left the company')

    const { calls } = mockFetch([
      ...baseRoutes(),
      {
        match: '/admin/users/1/deactivate',
        method: 'POST',
        response: { ...MEMBER, is_active: false, status: 'DEACTIVATED' },
      },
    ])

    renderWithAuth(<AdminUsers />)

    const row = (await screen.findByText('Owner Person')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Deactivate' }))

    await waitFor(() => {
      const call = calls.find((item) => item.url.includes('/admin/users/1/deactivate'))
      expect(call?.body).toEqual({ reason: 'Left the company' })
    })
  })

  it('will not let an admin deactivate or delete themselves', async () => {
    signInStorage()
    mockFetch(baseRoutes())

    renderWithAuth(<AdminUsers />)

    const row = (await screen.findByText('Admin Person')).closest('tr')!
    expect(within(row).getByRole('button', { name: 'Deactivate' })).toBeDisabled()
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(row).getByText('YOU')).toBeInTheDocument()
  })

  it('surfaces the server refusal when the last admin would be removed', async () => {
    signInStorage()
    // jsdom has no window.prompt; the reason box is not what this test is about.
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    mockFetch([
      ...baseRoutes(),
      {
        match: '/admin/users/1/deactivate',
        method: 'POST',
        status: 409,
        response: {
          code: 'CONFLICT',
          message: 'Cannot deactivate the only active administrator.',
          details: {},
        },
      },
    ])

    renderWithAuth(<AdminUsers />)

    const row = (await screen.findByText('Owner Person')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Deactivate' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('only active administrator')
  })

  it('asks for confirmation before deleting', async () => {
    signInStorage()
    const { calls } = mockFetch([
      ...baseRoutes(),
      { match: '/admin/users/1', method: 'DELETE', response: { message: 'Deleted.' } },
    ])

    renderWithAuth(<AdminUsers />)

    const row = (await screen.findByText('Owner Person')).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await userEvent.click(within(row).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    })
  })

  it('filters by role through the query string', async () => {
    signInStorage()
    const { calls } = mockFetch(baseRoutes())

    renderWithAuth(<AdminUsers />)
    await screen.findByText('Owner Person')

    await userEvent.selectOptions(screen.getByLabelText('Role'), 'ADMIN')

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('role=ADMIN'))).toBe(true)
    })
  })
})

describe('RequireAdmin', () => {
  it('turns an ordinary user away', async () => {
    signInStorage()
    mockFetch([{ match: '/auth/me', response: makeUser({ role: 'USER' }) }])

    renderWithAuth(<RequireAdmin />)

    expect(await screen.findByText('Administrators only')).toBeInTheDocument()
  })
})
