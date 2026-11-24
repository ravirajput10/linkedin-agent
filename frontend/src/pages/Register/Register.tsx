import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { cn } from 'cn'

import { useAuth } from '@/auth/AuthContext'
import { SignupForm } from '@/components/signup-form'
import { PlanSelection } from '@/components/plan-selection'
import { Card } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { authApi } from '@/services/api'

export function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [step, setStep] = useState<'form' | 'plan'>('form')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [turnstileToken, setTurnstileToken] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [submitting, setSubmitting] = useState(false)
  const [pendingVerification, setPendingVerification] = useState<string | null>(null)

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

  const minLength = config?.min_password_length ?? 8
  const mismatch = confirm.length > 0 && password !== confirm
  const tooShort = password.length > 0 && password.length < minLength

  function handleFormSubmit(event: FormEvent) {
    event.preventDefault()
    if (mismatch || tooShort) return
    if (!email.trim() || !password) return
    setError(null)
    setStep('plan')
  }

  async function handleCompleteRegistration(planId: string, billingCycle: 'monthly' | 'annual') {
    setError(null)
    setSubmitting(true)
    try {
      const result = await register({
        email: email.trim(),
        password,
        full_name: fullName.trim() || undefined,
        plan_id: planId,
        billing_cycle: billingCycle === 'annual' ? 'yearly' : 'monthly',
        turnstile_token: turnstileToken,
      })

      try {
        localStorage.setItem(
          'user_plan',
          JSON.stringify({ plan: planId, billingCycle, selectedAt: new Date().toISOString() })
        )
      } catch {}

      if (result.verificationRequired) {
        setPendingVerification(result.verificationToken)
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (caught) {
      setError(caught)
    } finally {
      setSubmitting(false)
    }
  }

  if (config?.allow_registration === false) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card className="p-8 text-center shadow-lg border-border">
            <h1 className="text-xl font-bold tracking-tight">Sign-up is closed</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              This instance does not accept public registrations. Ask an administrator to create an account for you.
            </p>
            <div className="mt-6">
              <Link to="/login" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                Back to sign in
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (pendingVerification !== null) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 p-6 md:p-10">
        <div className="w-full max-w-md">
          <Card className="p-8 text-center shadow-lg border-border">
            <h1 className="text-xl font-bold tracking-tight">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We sent a confirmation link to <span className="font-semibold text-foreground">{email}</span>. Confirm your address before signing in.
            </p>
            {pendingVerification && (
              <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-left">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                  Development mode (token generated):
                </p>
                <code className="mt-1 block break-all text-xs text-muted-foreground bg-background/50 p-2 rounded">
                  {pendingVerification}
                </code>
                <Link
                  to={`/verify-email?token=${encodeURIComponent(pendingVerification)}`}
                  className={cn(buttonVariants({ size: "sm" }), "mt-3 w-full")}
                >
                  Confirm now
                </Link>
              </div>
            )}
            <div className="mt-6">
              <Link to="/login" className={cn(buttonVariants({ variant: "ghost" }), "w-full")}>
                Back to sign in
              </Link>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-start py-6 sm:py-10 px-4 sm:px-6 bg-muted/40 overflow-y-auto">
      {step === 'plan' ? (
        <PlanSelection
          userEmail={email}
          userName={fullName}
          onSelectPlan={handleCompleteRegistration}
          onBack={() => setStep('form')}
          submitting={submitting}
          error={error}
        />
      ) : (
        <div className="w-full max-w-sm md:max-w-3xl my-auto">
          <SignupForm
            fullName={fullName}
            setFullName={setFullName}
            email={email}
            setEmail={setEmail}
            password={password}
            setPassword={setPassword}
            confirm={confirm}
            setConfirm={setConfirm}
            onSubmit={handleFormSubmit}
            submitting={submitting}
            error={error}
            minLength={minLength}
            mismatch={mismatch}
            tooShort={tooShort}
            submitLabel="Create new account"
            siteKey={secConfig?.turnstile_site_key}
            turnstileToken={turnstileToken}
            onTurnstileSuccess={(tok) => setTurnstileToken(tok)}
          />
        </div>
      )}
    </div>
  )
}
