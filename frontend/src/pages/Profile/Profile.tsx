import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  User as UserIcon,
  KeyRound,
  Sliders,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Shield,
  Briefcase,
  Building2,
  Globe,
  Lock,
  Mail,
} from 'lucide-react'

import { useAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ErrorState, LoadingState } from '@/components/ui'
import { LinkedInAccount } from '@/pages/Profile/LinkedInAccount'
import { DangerZone } from '@/components/DangerZone'
import { authApi } from '@/services/api'
import { ApiRequestError } from '@/services/client'
import type { UserSettings } from '@/types/api'

const TIMEZONES = [
  'UTC',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
]

function Notice({ tone, children }: { tone: 'positive' | 'critical'; children: React.ReactNode }) {
  const isPos = tone === 'positive'
  return (
    <div
      role="status"
      className={`rounded-lg border px-3 py-2 text-xs flex items-center gap-2 ${
        isPos
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300'
      }`}
    >
      {isPos ? (
        <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <AlertCircle className="size-4 shrink-0 text-rose-600 dark:text-rose-400" />
      )}
      <div className="font-medium">{children}</div>
    </div>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

export function Profile() {
  const { isAdmin } = useAuth()
  if (isAdmin) {
    return <Navigate to="/admin/profile" replace />
  }

  return (
    <div className="space-y-4 pb-12 text-slate-900 dark:text-slate-100 w-full">
      {/* ================= PAGE HEADER ================= */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          Your profile
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
          Your account details, your password, and the defaults applied to campaigns you create.
        </p>
      </div>

      {/* ================= BALANCED 2-COLUMN FULL-WIDTH GRID ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4.5 w-full items-start">
        {/* Left Column (Account Information & Campaign Defaults) */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-4.5">
          <ProfileCard />
          <AgentDefaultsCard />
        </div>

        {/* Right Column (User Profile Card, LinkedIn, Password & Active Sessions) */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-4.5">
          <UserSummaryCard />
          <LinkedInAccount />
          <PasswordCard />
          <SessionsCard />
        </div>
      </div>

      {/* ================= DANGER ZONE ================= */}
      <div className="pt-2">
        <DangerZone />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- user summary */

function UserSummaryCard() {
  const { user } = useAuth()
  if (!user) return null

  const initials = (user.full_name || user.email || 'U')
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase()

  return (
    <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 sm:p-5 space-y-3.5">
      <div className="flex items-center gap-3">
        <div className="size-12 rounded-full bg-gradient-to-tr from-[#2445C8] to-[#4361EE] flex items-center justify-center text-white font-bold text-base shadow-2xs ring-2 ring-blue-100 dark:ring-blue-900/50 shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white truncate">
              {user.full_name || 'Account User'}
            </h3>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {user.role}
            </span>
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5 flex items-center gap-1">
            <Mail className="size-3 text-slate-400 shrink-0" />
            <span className="truncate">{user.email}</span>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
        <div className="p-2 rounded-lg bg-slate-50/70 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
          <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Verification</span>
          {user.email_verified ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-xs">
              <CheckCircle2 className="size-3" /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold text-xs">
              <AlertCircle className="size-3" /> Unverified
            </span>
          )}
        </div>

        <div className="p-2 rounded-lg bg-slate-50/70 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800">
          <span className="text-[10px] uppercase font-semibold text-slate-400 block mb-0.5">Time Zone</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs truncate block" title={user.timezone || 'UTC'}>
            {user.timezone || 'UTC'}
          </span>
        </div>
      </div>

      {(user.job_title || user.company) && (
        <div className="p-2.5 rounded-lg bg-slate-50/70 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 text-xs space-y-1">
          {user.job_title && (
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <Briefcase className="size-3 text-slate-400 shrink-0" />
              <span className="truncate">{user.job_title}</span>
            </div>
          )}
          {user.company && (
            <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
              <Building2 className="size-3 text-slate-400 shrink-0" />
              <span className="truncate">{user.company}</span>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ profile */

function ProfileCard() {
  const { user, setUser } = useAuth()
  const [form, setForm] = useState({
    full_name: '',
    job_title: '',
    company: '',
    linkedin_url: '',
    timezone: 'UTC',
    bio: '',
  })

  useEffect(() => {
    if (!user) return
    setForm({
      full_name: user.full_name ?? '',
      job_title: user.job_title ?? '',
      company: user.company ?? '',
      linkedin_url: user.linkedin_url ?? '',
      timezone: user.timezone || 'UTC',
      bio: user.bio ?? '',
    })
  }, [user])

  const save = useMutation({
    mutationFn: authApi.updateProfile,
    onSuccess: (updated) => setUser(updated),
  })

  if (!user) return <LoadingState />

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate({
      full_name: form.full_name.trim() || null,
      job_title: form.job_title.trim() || null,
      company: form.company.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null,
      timezone: form.timezone,
      bio: form.bio.trim() || null,
    })
  }

  return (
    <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 sm:p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-blue-50 dark:bg-blue-950/50 text-[#2445C8] flex items-center justify-center">
            <UserIcon className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Account Details</h2>
            <p className="text-[11px] text-slate-400">Personal information and agent background</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3.5">
        {/* Email field (readonly) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Email address
          </label>
          <div className="relative">
            <Input
              value={user.email}
              readOnly
              disabled
              className="h-8.5 text-xs bg-slate-50/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 text-slate-500 pr-8 cursor-not-allowed"
            />
            <Lock className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-slate-400" />
          </div>
          <p className="text-[11px] text-slate-400 mt-1">
            Your sign-in address. Contact an administrator to change it.
          </p>
        </div>

        {/* 2-Column Grid: Full name & Job title */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <UserIcon className="size-3 text-slate-400" />
              <span>Full name</span>
            </label>
            <Input
              value={form.full_name}
              placeholder="e.g. Ravi Rajput"
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
              className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <Briefcase className="size-3 text-slate-400" />
              <span>Job title</span>
            </label>
            <Input
              value={form.job_title}
              placeholder="e.g. Growth Lead / Founder"
              onChange={(event) => setForm({ ...form, job_title: event.target.value })}
              className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <Building2 className="size-3 text-slate-400" />
              <span>Company</span>
            </label>
            <Input
              value={form.company}
              placeholder="e.g. Acme Corp"
              onChange={(event) => setForm({ ...form, company: event.target.value })}
              className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1.5">
              <Globe className="size-3 text-slate-400" />
              <span>Time zone</span>
            </label>
            <select
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
              className="w-full h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-card px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
            >
              {(TIMEZONES.includes(form.timezone)
                ? TIMEZONES
                : [form.timezone, ...TIMEZONES]
              ).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              Used when reporting daily limits and schedules.
            </p>
          </div>
        </div>

        {/* LinkedIn Profile URL */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            LinkedIn profile URL
          </label>
          <Input
            type="url"
            placeholder="https://www.linkedin.com/in/…"
            value={form.linkedin_url}
            onChange={(event) => setForm({ ...form, linkedin_url: event.target.value })}
            className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
          />
        </div>

        {/* About you (Bio) */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            About you
          </label>
          <Textarea
            rows={3}
            placeholder="Tell us about yourself and your value proposition..."
            value={form.bio}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
            className="text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800 resize-none"
          />
          <p className="text-[11px] text-slate-400 mt-1">
            Context the connection-message agent can draw on when drafting personalized outreach.
          </p>
        </div>

        {save.isSuccess && <Notice tone="positive">Profile saved.</Notice>}
        {save.isError && <Notice tone="critical">{errorMessage(save.error)}</Notice>}

        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            disabled={save.isPending}
            className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-medium h-8.5 px-4 rounded-lg shadow-2xs"
          >
            {save.isPending ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ----------------------------------------------------------------- password */

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const { data: config } = useQuery({
    queryKey: ['auth', 'config'],
    queryFn: authApi.config,
    staleTime: 5 * 60_000,
  })
  const minLength = config?.min_password_length ?? 8

  const change = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => {
      setCurrent('')
      setNext('')
      setConfirm('')
    },
  })

  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < minLength

  return (
    <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 sm:p-5 space-y-4">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div className="size-7 rounded-md bg-amber-50 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center">
          <KeyRound className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Password &amp; Security</h2>
          <p className="text-[11px] text-slate-400">Manage your sign-in credentials</p>
        </div>
      </div>

      <form
        className="space-y-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (!mismatch && !tooShort) change.mutate()
        }}
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Current password
          </label>
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              New password
            </label>
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              aria-invalid={tooShort}
              className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
            />
            <p className="text-[11px] text-slate-400 mt-1">At least {minLength} characters.</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Confirm password
            </label>
            <Input
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={mismatch}
              className="h-8.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
            />
          </div>
        </div>

        {mismatch && <Notice tone="critical">The two passwords do not match.</Notice>}
        {change.isSuccess && (
          <Notice tone="positive">
            {change.data.message} {change.data.detail}
          </Notice>
        )}
        {change.isError && <Notice tone="critical">{errorMessage(change.error)}</Notice>}

        <p className="text-[11px] text-slate-400">
          Changing your password signs you out on every other device.
        </p>

        <div className="flex justify-end pt-1">
          <Button
            type="submit"
            disabled={!current || !next || !confirm || mismatch || tooShort || change.isPending}
            className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-medium h-8.5 px-4 rounded-lg shadow-2xs"
          >
            {change.isPending ? 'Updating…' : 'Change password'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ----------------------------------------------------------- agent defaults */

const NUMBER_FIELDS: { key: keyof UserSettings; label: string; unit?: string }[] = [
  { key: 'max_people_per_day', label: 'People per day', unit: '/day' },
  { key: 'max_likes_per_day', label: 'Likes per day', unit: '/day' },
  { key: 'max_comments_per_day', label: 'Comments per day', unit: '/day' },
  { key: 'max_connections_per_day', label: 'Connections per day', unit: '/day' },
  { key: 'max_people_per_run', label: 'People per run', unit: '/run' },
  { key: 'min_action_delay_seconds', label: 'Minimum delay', unit: 'sec' },
  { key: 'max_action_delay_seconds', label: 'Maximum delay', unit: 'sec' },
  { key: 'initial_posts_to_like', label: 'Posts to like first', unit: 'posts' },
  { key: 'evaluate_post_index', label: 'Post to evaluate', unit: 'index' },
  { key: 'minimum_relevance_score', label: 'Minimum post score', unit: 'pts' },
  { key: 'minimum_candidate_score', label: 'Minimum candidate score', unit: 'pts' },
  { key: 'connection_delay_hours', label: 'Connection delay', unit: 'hrs' },
]

function AgentDefaultsCard() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<UserSettings | null>(null)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['auth', 'settings'],
    queryFn: authApi.settings,
  })

  useEffect(() => {
    if (data) setDraft(data)
  }, [data])

  const save = useMutation({
    mutationFn: (payload: Partial<UserSettings>) => authApi.updateSettings(payload),
    onSuccess: (updated) => {
      setDraft(updated)
      queryClient.setQueryData(['auth', 'settings'], updated)
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })

  if (isLoading || !draft) {
    return (
      <Card className="p-8">
        <LoadingState label="Loading campaign defaults…" />
      </Card>
    )
  }
  if (error) {
    return (
      <Card className="p-8">
        <ErrorState error={error} onRetry={() => refetch()} />
      </Card>
    )
  }

  function set<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  }

  return (
    <Card className="rounded-xl border border-slate-200/90 dark:border-border shadow-2xs bg-white dark:bg-card p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="size-7 rounded-md bg-purple-50 dark:bg-purple-950/50 text-purple-600 flex items-center justify-center">
            <Sliders className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Campaign Defaults</h2>
            <p className="text-[11px] text-slate-400">
              Copied into each new campaign upon creation without affecting running ones
            </p>
          </div>
        </div>

        <Button
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-medium h-8 px-3.5 rounded-lg shadow-2xs self-start sm:self-auto"
        >
          {save.isPending ? 'Saving…' : 'Save defaults'}
        </Button>
      </div>

      <div className="space-y-4">
        {/* Toggle: Dry run by default */}
        <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.default_dry_run}
            onChange={(e) => set('default_dry_run', e.target.checked)}
            className="size-4 rounded border-slate-300 text-[#2445C8] focus:ring-[#2445C8] mt-0.5"
          />
          <div>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              Dry run by default
            </span>
            <p className="text-[11px] text-slate-400">
              New campaigns simulate actions instead of performing real likes, comments, and connection invites.
            </p>
          </div>
        </label>

        {/* Section 1: Daily limits & pacing */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
            Daily Limits &amp; Pacing
          </h3>
          <div className="grid gap-2.5 grid-cols-2 sm:grid-cols-3">
            {NUMBER_FIELDS.map((field) => (
              <div
                key={field.key}
                className="p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900/30"
              >
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[11px] font-medium text-slate-600 dark:text-slate-400 truncate">
                    {field.label}
                  </label>
                  {field.unit && (
                    <span className="text-[10px] text-slate-400 font-mono">{field.unit}</span>
                  )}
                </div>
                <Input
                  type="number"
                  min={0}
                  value={String(draft[field.key] as number)}
                  onChange={(event) => set(field.key, Number(event.target.value) as never)}
                  className="h-7.5 text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800 font-semibold tabular-nums"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: Tone & Style */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
            Tone &amp; Messaging
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Comment length
              </label>
              <select
                value={draft.comment_length}
                onChange={(event) => set('comment_length', event.target.value as never)}
                className="w-full h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-card px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                {['SHORT', 'MEDIUM', 'LONG'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Comment style
              </label>
              <select
                value={draft.comment_style}
                onChange={(event) => set('comment_style', event.target.value as never)}
                className="w-full h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-card px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                {['PROFESSIONAL', 'TECHNICAL', 'CONVERSATIONAL'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Connection message
              </label>
              <select
                value={draft.connection_message_mode}
                onChange={(event) => set('connection_message_mode', event.target.value as never)}
                className="w-full h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-card px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
              >
                {['NONE', 'TEMPLATE', 'AI_GENERATED'].map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {draft.connection_message_mode === 'TEMPLATE' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Connection message template
              </label>
              <Textarea
                rows={3}
                value={draft.connection_message_template ?? ''}
                onChange={(event) =>
                  set('connection_message_template', event.target.value || null)
                }
                className="text-xs bg-white dark:bg-card border-slate-200 dark:border-slate-800"
              />
            </div>
          )}
        </div>

        {/* Section 3: Approvals Guardrails */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
            Approvals Guardrails
          </h3>
          <p className="text-[11px] text-slate-400 mb-2">
            REQUIRED holds the action in queue until manually approved. AUTOMATIC lets the agent execute directly.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['candidate_approval', 'Candidates Approval'],
                ['comment_approval', 'Comments Approval'],
                ['connection_approval', 'Connections Approval'],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {label}
                </label>
                <select
                  value={draft[key]}
                  onChange={(event) => set(key, event.target.value as never)}
                  className="w-full h-8.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-card px-2.5 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
                >
                  <option value="REQUIRED">REQUIRED</option>
                  <option value="AUTOMATIC">AUTOMATIC</option>
                </select>
              </div>
            ))}
          </div>
        </div>

        {/* Toggle: Generate comments */}
        <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.generate_comment}
            onChange={(e) => set('generate_comment', e.target.checked)}
            className="size-4 rounded border-slate-300 text-[#2445C8] focus:ring-[#2445C8] mt-0.5"
          />
          <div>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
              Generate comments
            </span>
            <p className="text-[11px] text-slate-400">
              Turn off to like posts without ever drafting an AI comment.
            </p>
          </div>
        </label>

        {save.isSuccess && <Notice tone="positive">Defaults saved.</Notice>}
        {save.isError && <Notice tone="critical">{errorMessage(save.error)}</Notice>}
      </div>
    </Card>
  )
}

/* ----------------------------------------------------------------- sessions */

function SessionsCard() {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const signOutEverywhere = useMutation({
    mutationFn: authApi.logoutEverywhere,
    onSuccess: async () => {
      navigate('/', { replace: true })
      await logout()
    },
  })

  return (
    <Card className="rounded-xl border border-rose-200/80 dark:border-rose-950/60 shadow-2xs bg-white dark:bg-card p-4 sm:p-5">
      <div className="space-y-3">
        <div className="flex items-center gap-2 pb-2 border-b border-rose-100 dark:border-rose-950/60">
          <div className="size-7 rounded-md bg-rose-50 dark:bg-rose-950/50 text-rose-600 flex items-center justify-center">
            <Shield className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Active Sessions</h2>
            <p className="text-[11px] text-slate-400">Device security &amp; authorization</p>
          </div>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Signed in somewhere you no longer trust? Terminate all active sessions, including this device.
        </p>

        <div className="flex justify-end pt-1">
          <Button
            variant="outline"
            disabled={signOutEverywhere.isPending}
            onClick={() => signOutEverywhere.mutate()}
            className="border-rose-200 dark:border-rose-900/80 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-medium h-8 px-3 rounded-lg w-full sm:w-auto justify-center"
          >
            <LogOut className="size-3.5 mr-1.5" />
            {signOutEverywhere.isPending ? 'Signing out…' : 'Sign out everywhere'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
