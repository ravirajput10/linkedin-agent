import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button, Field, Input, Spinner } from '@/components/ui'
import { AuthError, AuthShell } from '@/pages/Login/AuthShell'
import { authApi } from '@/services/api'

/**
 * Confirms an email address from the link token.
 *
 * Reachable whether or not REQUIRE_EMAIL_VERIFICATION is on, so a token issued
 * before the flag was turned on still works.
 */
export function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const attempted = useRef(false)

  const verify = useMutation({ mutationFn: authApi.verifyEmail })

  useEffect(() => {
    // StrictMode mounts effects twice in development; the token is single-use,
    // so the second attempt would always report failure.
    if (!token || attempted.current) return
    attempted.current = true
    verify.mutate(token)
  }, [token, verify])

  if (!token) return <ResendForm />

  if (verify.isPending || verify.isIdle) {
    return (
      <AuthShell title="Confirming your email">
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Spinner /> One moment…
        </p>
      </AuthShell>
    )
  }

  if (verify.isError) {
    return (
      <AuthShell
        title="That link did not work"
        footer={
          <Link to="/login" className="font-medium text-accent hover:underline">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-4">
          <AuthError error={verify.error} />
          <ResendForm inline />
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Email confirmed"
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      }
    >
      <p className="text-sm text-ink-muted">{verify.data?.message}</p>
    </AuthShell>
  )
}

function ResendForm({ inline = false }: { inline?: boolean }) {
  const [email, setEmail] = useState('')
  const resend = useMutation({ mutationFn: authApi.resendVerification })

  const form = (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        resend.mutate(email.trim())
      }}
    >
      <Field label="Email">
        <Input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@company.com"
        />
      </Field>
      <Button type="submit" variant="primary" className="w-full" loading={resend.isPending}>
        Send a new link
      </Button>

      {resend.isSuccess && (
        <div className="rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-ink-muted">
          <p>{resend.data.message}</p>
          {resend.data.detail && (
            <>
              <p className="mt-2 text-xs font-medium text-caution">
                Development only — no mail is actually sent
              </p>
              <Link
                to={`/verify-email?token=${encodeURIComponent(resend.data.detail)}`}
                className="mt-1 inline-block break-all text-xs font-medium text-accent hover:underline"
              >
                {resend.data.detail}
              </Link>
            </>
          )}
        </div>
      )}
    </form>
  )

  if (inline) return form

  return (
    <AuthShell
      title="Resend the confirmation link"
      subtitle="Enter the address you signed up with."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {form}
    </AuthShell>
  )
}
