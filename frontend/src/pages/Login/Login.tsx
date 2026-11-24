import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import { LoginForm } from '@/components/login-form'
import { authApi } from '@/services/api'

export function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)

  const { data: config } = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: authApi.config,
    staleTime: 5 * 60_000,
  })

  const { data: secConfig } = useQuery({
    queryKey: ['auth', 'security-config'],
    queryFn: authApi.securityConfig,
    staleTime: 10 * 60_000,
  })

  // Where the guard interrupted them, so sign-in returns them to it.
  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const loggedIn = await login(email.trim(), password, turnstileToken)
      const defaultDest = loggedIn.role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'
      navigate(redirectTo && redirectTo !== '/login' ? redirectTo : defaultDest, { replace: true })
    } catch (caught) {
      setError(caught)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-6 md:p-10">
      <div className="w-full max-w-sm md:max-w-3xl">
        <LoginForm
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          onSubmit={handleSubmit}
          submitting={submitting}
          error={error}
          allowRegistration={config?.allow_registration !== false}
          siteKey={secConfig?.turnstile_site_key}
          turnstileToken={turnstileToken}
          onTurnstileSuccess={(tok) => setTurnstileToken(tok)}
        />
      </div>
    </div>
  )
}
