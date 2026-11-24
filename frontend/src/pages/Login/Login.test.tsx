import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { Login } from '@/pages/Login/Login'
import { makeUser, mockFetch, renderWithAuth } from '@/test/utils'

const AUTH_CONFIG = {
  allow_registration: true,
  require_email_verification: false,
  min_password_length: 8,
}

function tokenResponse() {
  return {
    access_token: 'new-access-token',
    refresh_token: 'new-refresh-token',
    token_type: 'bearer',
    expires_at: '2026-10-07T12:00:00Z',
    user: makeUser(),
  }
}

describe('Login', () => {
  it('signs in and stores the session', async () => {
    const { calls } = mockFetch([
      { match: '/auth/config', response: AUTH_CONFIG },
      { match: '/auth/login', method: 'POST', response: tokenResponse() },
    ])

    renderWithAuth(<Login />)

    await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'test-password-123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => {
      expect(calls.some((call) => call.url.includes('/auth/login'))).toBe(true)
    })

    const login = calls.find((call) => call.url.includes('/auth/login'))
    expect(login?.body).toEqual({
      email: 'owner@example.com',
      password: 'test-password-123',
      turnstile_token: '',
    })

    await waitFor(() => {
      expect(window.localStorage.getItem('linkedin-agent.access-token')).toBe('new-access-token')
    })
  })

  it('shows the server message when the credentials are wrong', async () => {
    mockFetch([
      { match: '/auth/config', response: AUTH_CONFIG },
      {
        match: '/auth/login',
        method: 'POST',
        status: 401,
        response: {
          code: 'AUTHENTICATION_EXPIRED',
          message: 'Incorrect email or password.',
          details: {},
        },
      },
    ])

    renderWithAuth(<Login />)

    await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
    expect(window.localStorage.getItem('linkedin-agent.access-token')).toBeNull()
  })

  it('explains a deactivated account rather than blaming the password', async () => {
    mockFetch([
      { match: '/auth/config', response: AUTH_CONFIG },
      {
        match: '/auth/login',
        method: 'POST',
        status: 403,
        response: {
          code: 'AUTHENTICATION_EXPIRED',
          message: 'This account has been deactivated. Contact an administrator.',
          details: {},
        },
      },
    ])

    renderWithAuth(<Login />)

    await userEvent.type(screen.getByLabelText('Email'), 'owner@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'test-password-123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('deactivated')
  })

  it('hides the sign-up link when registration is closed', async () => {
    mockFetch([
      { match: '/auth/config', response: { ...AUTH_CONFIG, allow_registration: false } },
    ])

    renderWithAuth(<Login />)

    expect(await screen.findByText(/Sign-up is closed/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Create an account' })).not.toBeInTheDocument()
  })
})
