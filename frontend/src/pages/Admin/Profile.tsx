import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui'
import { LinkedInAccount } from '@/pages/Profile/LinkedInAccount'
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
  const classes =
    tone === 'positive'
      ? 'border-positive/30 bg-positive-soft text-positive'
      : 'border-critical/30 bg-critical-soft text-critical'
  return (
    <p role="status" className={`rounded-md border px-3 py-2 text-sm ${classes}`}>
      {children}
    </p>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

export function AdminProfile() {
  return (
    <>
      <PageHeader
        title="Admin profile"
        description="Your administrator account details, your password, and the defaults applied to campaigns you create."
      />
      <ProfileCard />
      <LinkedInAccount />
      <PasswordCard />
      <AgentDefaultsCard />
      <SessionsCard />
    </>
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
    <Card
      title="Account"
      action={
        <div className="flex items-center gap-2">
          <Badge tone={user.role === 'ADMIN' ? 'accent' : 'neutral'}>{user.role}</Badge>
          {!user.email_verified && <Badge tone="caution">EMAIL UNVERIFIED</Badge>}
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        <Field label="Email" hint="Your sign-in address. Contact an administrator to change it.">
          <Input value={user.email} readOnly disabled />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
            />
          </Field>
          <Field label="Job title">
            <Input
              value={form.job_title}
              onChange={(event) => setForm({ ...form, job_title: event.target.value })}
            />
          </Field>
          <Field label="Company">
            <Input
              value={form.company}
              onChange={(event) => setForm({ ...form, company: event.target.value })}
            />
          </Field>
          <Field label="Time zone" hint="Used when reporting daily limits and schedules.">
            <Select
              value={form.timezone}
              onChange={(event) => setForm({ ...form, timezone: event.target.value })}
            >
              {(TIMEZONES.includes(form.timezone)
                ? TIMEZONES
                : [form.timezone, ...TIMEZONES]
              ).map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="LinkedIn profile URL">
          <Input
            type="url"
            placeholder="https://www.linkedin.com/in/…"
            value={form.linkedin_url}
            onChange={(event) => setForm({ ...form, linkedin_url: event.target.value })}
          />
        </Field>

        <Field label="About you" hint="Context the connection-message agent can draw on.">
          <Textarea
            rows={3}
            value={form.bio}
            onChange={(event) => setForm({ ...form, bio: event.target.value })}
          />
        </Field>

        {save.isSuccess && <Notice tone="positive">Profile saved.</Notice>}
        {save.isError && <Notice tone="critical">{errorMessage(save.error)}</Notice>}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save profile
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
    <Card title="Password">
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (!mismatch && !tooShort) change.mutate()
        }}
      >
        <Field label="Current password">
          <Input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" hint={`At least ${minLength} characters.`}>
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
              aria-invalid={tooShort}
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={mismatch}
            />
          </Field>
        </div>

        {mismatch && <Notice tone="critical">The two passwords do not match.</Notice>}
        {change.isSuccess && (
          <Notice tone="positive">
            {change.data.message} {change.data.detail}
          </Notice>
        )}
        {change.isError && <Notice tone="critical">{errorMessage(change.error)}</Notice>}

        <p className="text-xs text-ink-faint">
          Changing your password signs you out on every other device.
        </p>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            loading={change.isPending}
            disabled={!current || !next || !confirm || mismatch || tooShort}
          >
            Change password
          </Button>
        </div>
      </form>
    </Card>
  )
}

/* ----------------------------------------------------------- agent defaults */

const NUMBER_FIELDS: { key: keyof UserSettings; label: string; hint?: string }[] = [
  { key: 'max_people_per_day', label: 'People per day' },
  { key: 'max_likes_per_day', label: 'Likes per day' },
  { key: 'max_comments_per_day', label: 'Comments per day' },
  { key: 'max_connections_per_day', label: 'Connections per day' },
  { key: 'max_people_per_run', label: 'People per run' },
  { key: 'min_action_delay_seconds', label: 'Minimum delay (seconds)' },
  { key: 'max_action_delay_seconds', label: 'Maximum delay (seconds)' },
  { key: 'initial_posts_to_like', label: 'Posts to like first' },
  { key: 'evaluate_post_index', label: 'Post to evaluate' },
  { key: 'minimum_relevance_score', label: 'Minimum post score' },
  { key: 'minimum_candidate_score', label: 'Minimum candidate score' },
  { key: 'connection_delay_hours', label: 'Connection delay (hours)' },
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

  if (isLoading || !draft) return <Card title="Campaign defaults"><LoadingState /></Card>
  if (error) {
    return (
      <Card title="Campaign defaults">
        <ErrorState error={error} onRetry={() => refetch()} />
      </Card>
    )
  }

  function set<K extends keyof UserSettings>(key: K, value: UserSettings[K]) {
    setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
  }

  return (
    <Card
      title="Campaign defaults"
      action={
        <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(draft!)}>
          Save defaults
        </Button>
      }
    >
      <div className="space-y-5 p-4">
        <p className="text-sm text-ink-muted">
          These are copied into each new campaign when you create it. Changing them never
          re-tunes a campaign that is already running — edit that campaign instead.
        </p>

        <Checkbox
          label="Dry run by default"
          hint="New campaigns simulate actions instead of performing them."
          checked={draft.default_dry_run}
          onChange={(event) => set('default_dry_run', event.target.checked)}
        />

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Daily limits &amp; pacing
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBER_FIELDS.map((field) => (
              <Field key={field.key} label={field.label} hint={field.hint}>
                <Input
                  type="number"
                  min={0}
                  value={String(draft[field.key] as number)}
                  onChange={(event) =>
                    set(field.key, Number(event.target.value) as never)
                  }
                />
              </Field>
            ))}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Tone
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Comment length">
              <Select
                value={draft.comment_length}
                onChange={(event) => set('comment_length', event.target.value as never)}
              >
                {['SHORT', 'MEDIUM', 'LONG'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Comment style">
              <Select
                value={draft.comment_style}
                onChange={(event) => set('comment_style', event.target.value as never)}
              >
                {['PROFESSIONAL', 'TECHNICAL', 'CONVERSATIONAL'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Connection message">
              <Select
                value={draft.connection_message_mode}
                onChange={(event) =>
                  set('connection_message_mode', event.target.value as never)
                }
              >
                {['NONE', 'TEMPLATE', 'AI_GENERATED'].map((value) => (
                  <option key={value} value={value}>
                    {value.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {draft.connection_message_mode === 'TEMPLATE' && (
            <div className="mt-3">
              <Field label="Connection message template">
                <Textarea
                  rows={3}
                  value={draft.connection_message_template ?? ''}
                  onChange={(event) =>
                    set('connection_message_template', event.target.value || null)
                  }
                />
              </Field>
            </div>
          )}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Approvals
          </h3>
          <p className="mb-2 text-xs text-ink-faint">
            REQUIRED holds the action until you approve it. AUTOMATIC lets the agent proceed.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['candidate_approval', 'Candidates'],
                ['comment_approval', 'Comments'],
                ['connection_approval', 'Connections'],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Select
                  value={draft[key]}
                  onChange={(event) => set(key, event.target.value as never)}
                >
                  <option value="REQUIRED">REQUIRED</option>
                  <option value="AUTOMATIC">AUTOMATIC</option>
                </Select>
              </Field>
            ))}
          </div>
        </div>

        <Checkbox
          label="Generate comments"
          hint="Turn off to like posts without ever drafting a comment."
          checked={draft.generate_comment}
          onChange={(event) => set('generate_comment', event.target.checked)}
        />

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
    <Card title="Sessions">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-sm text-ink-muted">
          Signed in somewhere you no longer trust? End every session, including this one.
        </p>
        <Button
          variant="danger"
          loading={signOutEverywhere.isPending}
          onClick={() => signOutEverywhere.mutate()}
        >
          Sign out everywhere
        </Button>
      </div>
    </Card>
  )
}
