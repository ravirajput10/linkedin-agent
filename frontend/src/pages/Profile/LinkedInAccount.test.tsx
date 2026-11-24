import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { LinkedInAccount } from '@/pages/Profile/LinkedInAccount'
import { mockFetch, renderWithProviders, signInStorage } from '@/test/utils'

function account(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'LINKEDIN',
    status: 'NOT_CONNECTED',
    connected: false,
    connected_at: null,
    disconnected_at: null,
    last_error: null,
    linking_enabled: true,
    ...overrides,
  }
}

describe('LinkedInAccount', () => {
  beforeEach(() => {
    signInStorage()
    // The Connect button navigates the whole page; jsdom cannot, so stand in.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, href: '' },
    })
  })

  it('offers to connect when no account is linked', async () => {
    mockFetch([{ match: '/integrations/linkedin', response: account() }])

    renderWithProviders(<LinkedInAccount />)

    expect(await screen.findByRole('button', { name: 'Connect LinkedIn' })).toBeEnabled()
    expect(screen.getByText('NOT CONNECTED')).toBeInTheDocument()
    expect(
      screen.getByText(/password is never sent to, or stored by, this application/i),
    ).toBeInTheDocument()
  })

  it('sends the browser to the hosted auth URL', async () => {
    mockFetch([
      { match: '/integrations/linkedin', response: account() },
      {
        match: '/integrations/linkedin/connect',
        method: 'POST',
        response: { url: 'https://account.unipile.com/abc123', expires_at: null },
      },
    ])

    renderWithProviders(<LinkedInAccount />)
    await userEvent.click(await screen.findByRole('button', { name: 'Connect LinkedIn' }))

    await waitFor(() => {
      expect(window.location.href).toBe('https://account.unipile.com/abc123')
    })
  })

  it('shows the connected state and hides the connect button', async () => {
    mockFetch([
      {
        match: '/integrations/linkedin',
        response: account({
          status: 'CONNECTED',
          connected: true,
          connected_at: '2026-10-12T09:00:00Z',
        }),
      },
    ])

    renderWithProviders(<LinkedInAccount />)

    expect(await screen.findByText('CONNECTED')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Connect LinkedIn/ })).not.toBeInTheDocument()
  })

  it('asks for confirmation before disconnecting', async () => {
    const { calls } = mockFetch([
      {
        match: '/integrations/linkedin',
        response: account({ status: 'CONNECTED', connected: true }),
      },
      {
        match: '/integrations/linkedin',
        method: 'DELETE',
        response: account({ status: 'DISCONNECTED' }),
      },
    ])

    renderWithProviders(<LinkedInAccount />)
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }))

    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Yes, disconnect' }))
    await waitFor(() => {
      expect(calls.some((c) => c.method === 'DELETE')).toBe(true)
    })
  })

  it('offers a reconnect when LinkedIn dropped the session', async () => {
    const { calls } = mockFetch([
      {
        match: '/integrations/linkedin',
        response: account({
          status: 'ERROR',
          last_error: 'LinkedIn signed this session out.',
        }),
      },
      {
        match: '/integrations/linkedin/connect',
        method: 'POST',
        response: { url: 'https://account.unipile.com/re', expires_at: null },
      },
    ])

    renderWithProviders(<LinkedInAccount />)

    expect(await screen.findByText('NEEDS RECONNECTING')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('LinkedIn signed this session out.')

    await userEvent.click(screen.getByRole('button', { name: 'Reconnect LinkedIn' }))
    await waitFor(() => {
      const call = calls.find((c) => c.url.includes('/connect'))
      // A reconnect must keep the same Unipile account rather than making a second.
      expect(call?.body).toEqual({ reconnect: true })
    })
  })

  it('explains a disabled button when the server is not configured', async () => {
    mockFetch([
      { match: '/integrations/linkedin', response: account({ linking_enabled: false }) },
    ])

    renderWithProviders(<LinkedInAccount />)

    expect(await screen.findByRole('button', { name: 'Connect LinkedIn' })).toBeDisabled()
    expect(screen.getByText(/not configured on this server/i)).toBeInTheDocument()
  })
it('triggers a live refresh check when Re-check is clicked', async () => {
    const { calls } = mockFetch([
      {
        match: '/integrations/linkedin',
        response: account({ status: 'CONNECTED', connected: true }),
      },
      {
        match: '/agent/status',
        response: { extension_online: true, extension_version: '1.0.0', account_tier: 'free' },
      },
      {
        match: '/integrations/linkedin/refresh',
        method: 'POST',
        response: account({ status: 'CONNECTED', connected: true }),
      },
    ])

    renderWithProviders(<LinkedInAccount />)

    const recheckButton = await screen.findByRole('button', { name: 'Re-check' })
    await userEvent.click(recheckButton)

    await waitFor(() => {
      expect(calls.some((c) => c.url.includes('/integrations/linkedin/refresh'))).toBe(true)
    })
    expect(await screen.findByText(/LinkedIn connection verified and active/i)).toBeInTheDocument()
  })
})
