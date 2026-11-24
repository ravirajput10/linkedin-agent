import { useEffect, useState, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { useAuth } from '@/auth/AuthContext'
import { consumeOAuthState } from '@/auth/oauthState'
import { authApi } from '@/services/api'
import { Button } from '@/components/ui/button'

export function OAuthCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setSessionTokens } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const isExecutingRef = useRef(false)

  useEffect(() => {
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const errorParam = searchParams.get('error')
    const errorDesc = searchParams.get('error_description')

    if (errorParam) {
      setError(errorDesc || 'LinkedIn sign-in was cancelled or encountered an error.')
      return
    }

    if (!code) {
      setError('No authorization code was returned by LinkedIn.')
      return
    }

    if (isExecutingRef.current) {
      return
    }
    isExecutingRef.current = true

    if (!consumeOAuthState(state)) {
      setError('This sign-in was not started from this browser tab. Start LinkedIn sign-in again.')
      return
    }

    const redirectUri = window.location.origin + window.location.pathname

    authApi
      .linkedinCallback(code, state || '', redirectUri)
      .then(async (tokens) => {
        setSessionTokens(tokens)
        // If user already completed onboarding, go straight to Dashboard
        if (tokens.user && (tokens.user as { onboarding_step?: number }).onboarding_step && (tokens.user as { onboarding_step?: number }).onboarding_step! >= 4) {
          navigate('/dashboard', { replace: true })
          return
        }
        try {
          const onboarding = await authApi.onboarding()
          if (onboarding.step >= 4 || onboarding.completed) {
            navigate('/dashboard', { replace: true })
            return
          }
        } catch {
          // ignore
        }
        navigate('/login', { replace: true })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to complete LinkedIn authentication.')
      })
  }, [searchParams, setSessionTokens, navigate])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-background">
        <div className="max-w-md w-full bg-white dark:bg-card border border-rose-200 dark:border-rose-900/60 rounded-2xl p-8 shadow-sm text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center mx-auto text-rose-600 dark:text-rose-400">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Authentication Failed</h2>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {error}
          </p>
          <div className="pt-2">
            <Button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="w-full bg-[#0A66C2] hover:bg-[#09529d] text-white rounded-xl text-xs sm:text-sm font-medium cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Return to Sign In
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50 dark:bg-background">
      <div className="max-w-md w-full bg-white dark:bg-card border border-slate-200 dark:border-border rounded-2xl p-8 shadow-sm text-center space-y-4">
        <Loader2 className="h-8 w-8 text-[#0A66C2] animate-spin mx-auto" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Connecting with LinkedIn...</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Verifying your LinkedIn credentials and setting up your workspace.
        </p>
      </div>
    </div>
  )
}
