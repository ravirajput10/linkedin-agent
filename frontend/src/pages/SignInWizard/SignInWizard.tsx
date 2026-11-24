import { useState, useEffect, type FormEvent } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Sparkles,
  Check,
  ChevronDown,
  Lock,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Loader2,
  Wifi,
  WifiOff,
} from 'lucide-react'

import { useAuth } from '@/auth/AuthContext'
import { rememberOAuthState } from '@/auth/oauthState'
import { authApi, agentApi } from '@/services/api'
import { loadTokens } from '@/services/tokens'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TurnstileWidget } from '@/components/TurnstileWidget'

type Step = 1 | 2 | 3
type ApprovalMode = 'all' | 'posts' | 'automatic'

export function SignInWizard() {
  const { user, isAuthenticated, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // Track the wizard step (1: Sign in, 2: Connect account, 3: Approval mode)
  const [step, setStep] = useState<Step>(isAuthenticated ? 2 : 1)

  // Save selected plan from query parameter if user clicked a specific pricing tier
  useEffect(() => {
    const plan = searchParams.get('plan')
    if (plan) {
      sessionStorage.setItem('selected_plan', plan)
    }
  }, [searchParams])

  // Step 1: Email/Password toggle & form
  const [showEmailAuth, setShowEmailAuth] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isLinkedInLoading, setIsLinkedInLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string>('')
  const [turnstileToken, setTurnstileToken] = useState<string>('')

  useEffect(() => {
    authApi
      .securityConfig()
      .then((cfg) => {
        if (cfg && typeof cfg.turnstile_site_key === 'string' && cfg.turnstile_site_key.trim().length > 0) {
          setTurnstileSiteKey(cfg.turnstile_site_key)
        }
      })
      .catch(() => {})
  }, [])

  // Step 2: Account connection state
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null)
  const [agentStatus, setAgentStatus] = useState<string>('NOT_CONNECTED')
  const [extensionOnline, setExtensionOnline] = useState<boolean>(false)
  const [accountTier, setAccountTier] = useState<string>('FREE')

  // Step 3: Approval mode selection
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>('all')

  const redirectTo = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname

  // FR-1.3: Resume wizard across sessions from server onboarding_step
  useEffect(() => {
    if (!isAuthenticated) return
    let active = true
    authApi
      .onboarding()
      .then((status) => {
        if (!active) return
        // Completed onboarding users go straight to Dashboard
        if (status.step >= 4 || status.completed) {
          navigate(redirectTo && redirectTo !== '/login' && redirectTo !== '/' ? redirectTo : '/dashboard', { replace: true })
          return
        }
        // If extension is not online/verified yet, keep user on Step 2
        if (!status.extension_online) {
          setStep(2)
        } else if (status.step >= 1 && status.step <= 3) {
          setStep((Math.max(2, status.step) as Step) || 2)
        }
        if (status.approval_mode) {
          setApprovalMode(status.approval_mode as ApprovalMode)
        }
        if (status.account_tier) {
          setAccountTier(status.account_tier)
        }
        setExtensionOnline(status.extension_online)
        setAgentStatus(status.connection_status || (status.extension_online ? 'CONNECTED' : 'EXTENSION_OFFLINE'))
      })
      .catch(() => {
        // Fall back to local step
      })
    return () => {
      active = false
    }
  }, [isAuthenticated])

  // FR-1.1 & FR-1.2: Handle Real LinkedIn OAuth Continue
  const handleLinkedInContinue = async () => {
    if (isAuthenticated) {
      setStep(2)
      return
    }
    setIsLinkedInLoading(true)
    setAuthError(null)
    try {
      const res = await authApi.linkedinAuthorize()
      if (res.authorize_url) {
        rememberOAuthState(res.state)
        window.location.href = res.authorize_url
      } else {
        throw new Error('No authorization URL returned by server.')
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'LinkedIn sign-in failed. Please try again.')
      setIsLinkedInLoading(false)
    }
  }

  // Handle Email/Password Login
  const handleEmailLogin = async (e: FormEvent) => {
    e.preventDefault()
    setAuthError(null)
    setIsSubmitting(true)
    try {
      if (!turnstileToken) {
        setAuthError('Please complete the security challenge before signing in.')
        setIsSubmitting(false)
        return
      }
      await login(email.trim(), password, turnstileToken)
      const onboarding = await authApi.onboarding()
      if (onboarding.step >= 4 || onboarding.completed) {
        navigate(redirectTo && redirectTo !== '/login' && redirectTo !== '/' ? redirectTo : '/dashboard', { replace: true })
        return
      }
      setStep((Math.max(2, onboarding.step) as Step) || 2)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid credentials. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // FR-1.4 & FR-1.7: Check real agent status from server
  const checkAgentStatus = async () => {
    try {
      const res = await agentApi.status()
      setAgentStatus(res.connection_status || res.status || 'EXTENSION_OFFLINE')
      setExtensionOnline(res.extension_online)
      setAccountTier(res.account_tier || 'FREE')
      return res
    } catch {
      return null
    }
  }

  // Handle Verify button on Step 2
  const handleVerify = async () => {
    setIsVerifying(true)
    setVerifyNotice(null)
    try {
      const tokens = loadTokens()
      // Signal extension content script with active access token to sync and heartbeat
      window.postMessage({
        type: 'AGENT_VERIFY_REQUEST',
        token: tokens?.accessToken,
        user: { full_name: user?.full_name, email: user?.email },
      }, '*')
      await new Promise((resolve) => setTimeout(resolve, 600))

      const res = await checkAgentStatus()
      if (res && (res.connected || res.extension_online || res.connection_status === 'CONNECTED')) {
        setVerifyNotice('✓ Chrome extension active & LinkedIn session linked!')
        await authApi.updateOnboarding({ step: 3 })
        setTimeout(() => {
          setIsVerifying(false)
          setStep(3)
        }, 600)
      } else {
        setVerifyNotice('Extension not detected yet. Follow the steps below to load the extension in Chrome, then click verify.')
        setIsVerifying(false)
      }
    } catch {
      setVerifyNotice('Verification error. Please ensure the agent service is reachable.')
      setIsVerifying(false)
    }
  }

  // Handle Finish on Step 3
  const handleFinish = async () => {
    try {
      localStorage.setItem('linkedin-agent.approval-mode', approvalMode)
      await authApi.updateOnboarding({ step: 4, approval_mode: approvalMode })
    } catch {
      // ignore
    }
    navigate(redirectTo && redirectTo !== '/login' && redirectTo !== '/' ? redirectTo : '/dashboard', { replace: true })
  }

  const displayName = user?.full_name || (user?.email ? user.email.split('@')[0] : 'Parikshit Patel')

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50 dark:bg-background text-foreground antialiased">
      {/* ================= LEFT BRAND PANEL ================= */}
      <div className="w-full lg:w-[460px] xl:w-[500px] bg-[#0B132B] text-white p-8 sm:p-12 lg:p-14 flex flex-col justify-between shrink-0 shadow-2xl z-10">
        <div>
          {/* Logo Pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1A2E69]/90 border border-blue-400/25 text-white font-medium text-xs sm:text-sm shadow-inner backdrop-blur-xs">
            <Sparkles className="h-3.5 w-3.5 text-blue-300 fill-blue-300" />
            <span className="tracking-wide">AI Engagement Agent</span>
          </div>

          {/* Headline & Description */}
          <div className="mt-12 lg:mt-16 space-y-4">
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-[1.18]">
              Describe who you want to reach. Your agent warms them up.
            </h1>
            <p className="text-slate-300 text-sm sm:text-base leading-relaxed pt-1">
              Find the right people with a plain-English prompt, engage with their posts in your voice, and grow your profile with content you approve.
            </p>
          </div>

          {/* 4 Value Pillars */}
          <div className="mt-12 sm:mt-14 space-y-4">
            <div className="flex items-center gap-3.5">
              <span className="font-mono text-xs sm:text-sm font-semibold text-blue-400 select-none">01</span>
              <span className="text-xs sm:text-sm text-slate-200 font-normal">Prompt-based audience discovery</span>
            </div>
            <div className="flex items-center gap-3.5">
              <span className="font-mono text-xs sm:text-sm font-semibold text-blue-400 select-none">02</span>
              <span className="text-xs sm:text-sm text-slate-200 font-normal">
                Rule-based engagement: like → comment → connect
              </span>
            </div>
            <div className="flex items-center gap-3.5">
              <span className="font-mono text-xs sm:text-sm font-semibold text-blue-400 select-none">03</span>
              <span className="text-xs sm:text-sm text-slate-200 font-normal">AI content for your own profile</span>
            </div>
            <div className="flex items-center gap-3.5">
              <span className="font-mono text-xs sm:text-sm font-semibold text-blue-400 select-none">04</span>
              <span className="text-xs sm:text-sm text-slate-200 font-normal">Human approval before anything goes live</span>
            </div>
          </div>
        </div>

        {/* Bottom subtle assurance */}
        <div className="pt-8 mt-auto border-t border-slate-800/80 flex items-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>Enterprise-grade security and session sandboxing</span>
        </div>
      </div>

      {/* ================= RIGHT WIZARD PANEL ================= */}
      <div className="flex-1 flex flex-col justify-center items-center p-6 sm:p-10 lg:p-12 overflow-y-auto">
        <div className="w-full max-w-[500px]">
          {/* Top Step Progress Bar */}
          <div className="mb-8">
            <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm font-medium text-slate-500 mb-2">
              <button
                type="button"
                onClick={() => setStep(1)}
                className={`text-left transition-colors ${
                  step >= 1 ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-400'
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                className={`text-left transition-colors ${
                  step >= 2 ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-400'
                }`}
              >
                Connect account
              </button>
              <button
                type="button"
                onClick={() => setStep(3)}
                className={`text-left transition-colors ${
                  step >= 3 ? 'text-slate-900 dark:text-slate-100 font-semibold' : 'text-slate-400'
                }`}
              >
                Approval mode
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div
                className={`h-1 rounded-full transition-all duration-300 ${
                  step >= 1 ? 'bg-[#2445C8]' : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
              <div
                className={`h-1 rounded-full transition-all duration-300 ${
                  step >= 2 ? 'bg-[#2445C8]' : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
              <div
                className={`h-1 rounded-full transition-all duration-300 ${
                  step >= 3 ? 'bg-[#2445C8]' : 'bg-slate-200 dark:bg-slate-800'
                }`}
              />
            </div>
          </div>

          {/* Central Card */}
          <div className="bg-white dark:bg-card border border-slate-200/90 dark:border-border rounded-2xl shadow-sm p-7 sm:p-9 transition-all">
            {/* ---------------- STEP 1: SIGN IN ---------------- */}
            {step === 1 && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-2">
                    STEP 1 OF 3
                  </span>
                  <h2 className="text-2xl sm:text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">
                    Sign in
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm mt-2 leading-relaxed">
                    Use your LinkedIn account to create your workspace. We only read your basic profile to set you up.
                  </p>
                </div>

                {authError && (
                  <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg p-2.5">
                    {authError}
                  </div>
                )}

                {/* Primary Continue with LinkedIn Button */}
                <button
                  type="button"
                  disabled={isLinkedInLoading}
                  onClick={handleLinkedInContinue}
                  className="w-full flex items-center justify-center gap-2.5 bg-[#0A66C2] hover:bg-[#09529d] active:scale-[0.99] disabled:opacity-75 text-white font-medium py-3 px-4 rounded-xl shadow-xs transition-all cursor-pointer text-sm"
                >
                  {isLinkedInLoading ? (
                    <>
                      <Loader2 className="h-4.5 w-4.5 animate-spin mr-1" />
                      <span>Signing in with LinkedIn...</span>
                    </>
                  ) : (
                    <>
                      <svg className="h-4.5 w-4.5 fill-current" viewBox="0 0 24 24">
                        <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                      </svg>
                      <span>Continue with LinkedIn</span>
                    </>
                  )}
                </button>

                <p className="text-[12px] text-slate-500 text-center leading-normal">
                  By continuing you agree to the{' '}
                  <span className="underline hover:text-slate-800 cursor-pointer">Terms</span> and{' '}
                  <span className="underline hover:text-slate-800 cursor-pointer">Privacy Policy</span>.
                </p>

                {/* Secondary Toggle for Email/Password Sign-In (Requested) */}
                <div className="pt-4 border-t border-slate-100 dark:border-border/60">
                  <button
                    type="button"
                    onClick={() => setShowEmailAuth((prev) => !prev)}
                    className="w-full flex items-center justify-between p-2.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 bg-slate-50 dark:bg-muted/50 hover:bg-slate-100 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5 text-slate-400" />
                      <span>Standard Email/Password Sign-In</span>
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-slate-400">
                      <span>Admin & Local Test</span>
                      <ChevronDown
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${
                          showEmailAuth ? 'rotate-180' : ''
                        }`}
                      />
                    </span>
                  </button>

                  {showEmailAuth && (
                    <form onSubmit={handleEmailLogin} className="mt-4 space-y-3.5 animate-in fade-in-50 duration-200">
                      {authError && (
                        <div className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg p-2.5">
                          {authError}
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor="email" className="text-xs text-slate-700 dark:text-slate-200">
                          Email address
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="admin@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          required
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="password" className="text-xs text-slate-700 dark:text-slate-200">
                          Password
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          placeholder="••••••••"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          className="h-9 text-xs"
                        />
                      </div>
                      <div className="pt-1">
                        <TurnstileWidget
                          siteKey={turnstileSiteKey || undefined}
                          onSuccess={(token) => setTurnstileToken(token)}
                          onError={() => setTurnstileToken('')}
                          onExpire={() => setTurnstileToken('')}
                        />
                      </div>
                      <Button
                        type="submit"
                        disabled={isSubmitting || !turnstileToken}
                        className="w-full h-9 text-xs bg-slate-900 text-white hover:bg-slate-800"
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                            Signing in...
                          </>
                        ) : (
                          'Sign In with Credentials'
                        )}
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- STEP 2: CONNECT ACCOUNT ---------------- */}
            {step === 2 && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-2">
                    STEP 2 OF 3
                  </span>
                  <h2 className="text-2xl sm:text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">
                    Connect your LinkedIn account
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm mt-2 leading-relaxed">
                    The Chrome extension lets your agent act from your own browser session, so activity looks and behaves like you.
                  </p>
                </div>

                {/* Signed-in badge */}
                <div className="bg-[#EBF7EE] dark:bg-emerald-950/40 border border-[#CEEBD3] dark:border-emerald-800/60 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs sm:text-sm font-medium text-[#1E7E34] dark:text-emerald-400">
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4 stroke-[2.5]" />
                    <span>Signed in as {displayName}</span>
                  </div>
                  {accountTier && (
                    <span className="text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
                      {accountTier}
                    </span>
                  )}
                </div>

                {/* Real-time Status Badge (FR-1.4 & FR-1.7) */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-muted/40 border border-slate-200 dark:border-border text-xs">
                  <span className="text-slate-600 dark:text-slate-300 font-medium">Extension & Session Status:</span>
                  <div className="flex items-center gap-2">
                    {extensionOnline || agentStatus === 'CONNECTED' ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        <Wifi className="h-3 w-3" />
                        <span>Connected & Online</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        <WifiOff className="h-3 w-3" />
                        <span>Extension Offline</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Chrome Extension Connection Card */}
                <div className="p-4 rounded-xl border border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-500/50 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 rounded-full border border-[#2445C8] bg-[#2445C8] flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-white" />
                    </div>
                    <div>
                      <span className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white block">
                        Chrome extension
                      </span>
                      <span className="text-[11px] text-slate-500">
                        Links your local browser session to run automated profile actions
                      </span>
                    </div>
                  </div>

                  <a
                    href="https://chromewebstore.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card hover:bg-slate-50 dark:hover:bg-muted/60 text-xs font-medium text-slate-800 dark:text-slate-200 shadow-2xs transition-colors"
                  >
                    <span>Add to Chrome</span>
                    <ExternalLink className="h-3 w-3 text-slate-400" />
                  </a>
                </div>

                {/* Local Developer Instructions for Unpacked Extension */}
                {!extensionOnline && agentStatus !== 'CONNECTED' && (
                  <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 text-xs text-slate-700 dark:text-slate-300 space-y-2">
                    <div className="font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
                      <span>Extension Setup (Quick 3 Steps):</span>
                    </div>
                    <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600 dark:text-slate-300 pl-1">
                      <li>Open <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-mono text-[10px]">chrome://extensions</code> in a new tab</li>
                      <li>Turn ON <strong className="text-slate-800 dark:text-slate-100">Developer mode</strong> in the top-right corner</li>
                      <li>Click <strong className="text-slate-800 dark:text-slate-100">Load unpacked</strong> and select the directory:<br/>
                        <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[10px] block mt-1 break-all">linkedin-agent\extension\dist</code>
                      </li>
                    </ol>
                    <p className="text-[11px] text-slate-500 pt-1">
                      Once loaded, click <strong className="text-slate-700 dark:text-slate-200">"I've installed it — verify"</strong> below. It will automatically sync your session and turn online.
                    </p>
                  </div>
                )}

                {verifyNotice && (
                  <div className={`text-xs p-2.5 rounded-lg ${
                    verifyNotice.startsWith('✓')
                      ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800'
                      : 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30'
                  }`}>
                    {verifyNotice}
                  </div>
                )}

                {/* Bottom navigation */}
                <div className="flex items-center gap-3 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(1)}
                    className="h-10 px-5 text-xs sm:text-sm font-medium rounded-xl border-slate-200"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={handleVerify}
                    disabled={isVerifying}
                    className="flex-1 h-10 text-xs sm:text-sm font-medium bg-[#2445C8] hover:bg-[#1d38a8] text-white rounded-xl shadow-xs"
                  >
                    {isVerifying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                        Verifying connection...
                      </>
                    ) : (
                      "I've installed it — verify"
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* ---------------- STEP 3: APPROVAL MODE ---------------- */}
            {step === 3 && (
              <div className="space-y-6">
                <div>
                  <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block mb-2">
                    STEP 3 OF 3
                  </span>
                  <h2 className="text-2xl sm:text-[26px] font-bold text-slate-900 dark:text-white tracking-tight">
                    How hands-on do you want to be?
                  </h2>
                  <p className="text-slate-600 dark:text-slate-300 text-xs sm:text-sm mt-2 leading-relaxed">
                    You can change this per campaign later.
                  </p>
                </div>

                {/* 3 Selectable Mode Cards */}
                <div className="space-y-3">
                  {/* Card 1: Approve everything (Recommended) */}
                  <div
                    onClick={() => setApprovalMode('all')}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      approvalMode === 'all'
                        ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-500/60'
                        : 'border-slate-200 dark:border-border hover:bg-slate-50 dark:hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-4.5 h-4.5 rounded-full border mt-0.5 flex items-center justify-center shrink-0 transition-colors ${
                          approvalMode === 'all'
                            ? 'border-[#2445C8] bg-[#2445C8]'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-card'
                        }`}
                      >
                        {approvalMode === 'all' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">
                            Approve everything
                          </span>
                          <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/50 px-2 py-0.5 rounded-md">
                            Recommended
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                          Comments, connection notes and posts wait for you. Likes run automatically.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Card 2: Approve posts only */}
                  <div
                    onClick={() => setApprovalMode('posts')}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      approvalMode === 'posts'
                        ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-500/60'
                        : 'border-slate-200 dark:border-border hover:bg-slate-50 dark:hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-4.5 h-4.5 rounded-full border mt-0.5 flex items-center justify-center shrink-0 transition-colors ${
                          approvalMode === 'posts'
                            ? 'border-[#2445C8] bg-[#2445C8]'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-card'
                        }`}
                      >
                        {approvalMode === 'posts' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white block">
                          Approve posts only
                        </span>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                          Engagement runs on its own; content for your profile waits for you.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Card 3: Fully automatic */}
                  <div
                    onClick={() => setApprovalMode('automatic')}
                    className={`p-4 rounded-xl border transition-all cursor-pointer ${
                      approvalMode === 'automatic'
                        ? 'border-blue-500 bg-blue-50/20 dark:bg-blue-950/20 ring-1 ring-blue-500/60'
                        : 'border-slate-200 dark:border-border hover:bg-slate-50 dark:hover:bg-muted/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`w-4.5 h-4.5 rounded-full border mt-0.5 flex items-center justify-center shrink-0 transition-colors ${
                          approvalMode === 'automatic'
                            ? 'border-[#2445C8] bg-[#2445C8]'
                            : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-card'
                        }`}
                      >
                        {approvalMode === 'automatic' && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="space-y-1">
                        <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white block">
                          Fully automatic
                        </span>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                          Everything runs within your daily limits. You get a daily digest.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom navigation */}
                <div className="flex items-center gap-3 pt-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(2)}
                    className="h-10 px-5 text-xs sm:text-sm font-medium rounded-xl border-slate-200"
                  >
                    Back
                  </Button>
                  <Button
                    type="button"
                    onClick={handleFinish}
                    className="flex-1 h-10 text-xs sm:text-sm font-medium bg-[#2445C8] hover:bg-[#1d38a8] text-white rounded-xl shadow-xs"
                  >
                    <span>Go to dashboard</span>
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
