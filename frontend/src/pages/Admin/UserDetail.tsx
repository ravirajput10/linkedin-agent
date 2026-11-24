import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { useAuth } from '@/auth/AuthContext'
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Stat,
  StatusBadge,
} from '@/components/ui'
import { adminApi } from '@/services/api'
import { ApiRequestError } from '@/services/client'
import { formatDateTime } from '@/utils/format'

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

export function AdminUserDetail() {
  const { id } = useParams()
  const userId = Number(id)
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()

  const user = useQuery({
    queryKey: ['admin', 'users', userId],
    queryFn: () => adminApi.getUser(userId),
    enabled: Number.isFinite(userId),
  })

  const settings = useQuery({
    queryKey: ['admin', 'users', userId, 'settings'],
    queryFn: () => adminApi.userSettings(userId),
    enabled: Number.isFinite(userId),
  })

  const campaigns = useQuery({
    queryKey: ['admin', 'users', userId, 'campaigns'],
    queryFn: () => adminApi.userCampaigns(userId, { page_size: 50 }),
    enabled: Number.isFinite(userId),
  })

  const [newPassword, setNewPassword] = useState('')

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin'] })
  }

  const toggleActive = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? adminApi.activate(userId)
        : adminApi.deactivate(
            userId,
            window.prompt('Reason for deactivating (optional):') ?? undefined,
          ),
    onSuccess: invalidate,
  })

  const resetPassword = useMutation({
    mutationFn: () => adminApi.resetPassword(userId, newPassword),
    onSuccess: () => setNewPassword(''),
  })

  if (user.isLoading) return <LoadingState />
  if (user.error || !user.data) {
    return <ErrorState error={user.error} onRetry={() => user.refetch()} />
  }

  const row = user.data
  const isSelf = row.id === currentUser?.id

  return (
    <>
      <PageHeader
        title={row.full_name || row.email}
        description={row.email}
        action={
          <div className="flex gap-2">
            <Link to="/admin/users">
              <Button>Back to users</Button>
            </Link>
            <Button
              variant={row.is_active ? 'danger' : 'primary'}
              disabled={isSelf}
              loading={toggleActive.isPending}
              title={isSelf ? 'You cannot deactivate your own account.' : undefined}
              onClick={() => toggleActive.mutate(!row.is_active)}
            >
              {row.is_active ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        }
      />

      {toggleActive.isError && (
        <p role="alert" className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
          {errorMessage(toggleActive.error)}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Campaigns" value={row.campaign_count} hint={`${row.active_campaign_count} running`} />
        <Stat label="Candidates" value={row.candidate_count} />
        <Stat
          label="Member since"
          value={new Date(row.created_at).toLocaleDateString(undefined, {
            month: 'short',
            year: 'numeric',
          })}
        />
        <Stat
          label="Last sign-in"
          value={row.last_login_at ? formatDateTime(row.last_login_at) : 'Never'}
        />
      </div>

      <Card
        title="Account"
        action={
          <div className="flex gap-2">
            <StatusBadge status={row.role} />
            <StatusBadge status={row.status} />
          </div>
        }
      >
        <dl className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Email" value={row.email} />
          <Detail label="Full name" value={row.full_name ?? '—'} />
          <Detail label="Job title" value={row.job_title ?? '—'} />
          <Detail label="Company" value={row.company ?? '—'} />
          <Detail label="Time zone" value={row.timezone} />
          <Detail label="Email verified" value={row.email_verified ? 'Yes' : 'No'} />
          {!row.is_active && (
            <>
              <Detail label="Deactivated" value={formatDateTime(row.deactivated_at)} />
              <Detail label="Reason" value={row.deactivated_reason ?? '—'} />
            </>
          )}
        </dl>
      </Card>

      <Card title="Reset password">
        <form
          className="flex flex-wrap items-end gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            resetPassword.mutate()
          }}
        >
          <div className="min-w-56 flex-1">
            <Field
              label="New password"
              hint="This ends all of their active sessions. Tell them the new password out of band."
            >
              <Input
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
            </Field>
          </div>
          <Button
            type="submit"
            variant="danger"
            loading={resetPassword.isPending}
            disabled={newPassword.length < 8}
          >
            Reset password
          </Button>
        </form>
        {resetPassword.isSuccess && (
          <p className="border-t border-border-subtle bg-positive-soft px-4 py-2 text-sm text-positive">
            {resetPassword.data.message} {resetPassword.data.detail}
          </p>
        )}
        {resetPassword.isError && (
          <p role="alert" className="border-t border-border-subtle bg-critical-soft px-4 py-2 text-sm text-critical">
            {errorMessage(resetPassword.error)}
          </p>
        )}
      </Card>

      <Card title="Their campaigns">
        {campaigns.isLoading && <LoadingState />}
        {campaigns.data && campaigns.data.items.length === 0 && (
          <EmptyState title="No campaigns yet" description="This account has not created one." />
        )}
        {campaigns.data && campaigns.data.items.length > 0 && (
          <ul className="divide-y divide-border-subtle">
            {campaigns.data.items.map((campaign) => (
              <li key={campaign.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{campaign.name}</p>
                  <p className="text-xs text-ink-faint">
                    Created {formatDateTime(campaign.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  {campaign.dry_run && <Badge tone="caution">DRY RUN</Badge>}
                  <StatusBadge status={campaign.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Their campaign defaults">
        {settings.isLoading && <LoadingState />}
        {settings.data && (
          <dl className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Dry run default" value={settings.data.default_dry_run ? 'On' : 'Off'} />
            <Detail label="People / day" value={settings.data.max_people_per_day} />
            <Detail label="Likes / day" value={settings.data.max_likes_per_day} />
            <Detail label="Comments / day" value={settings.data.max_comments_per_day} />
            <Detail label="Connections / day" value={settings.data.max_connections_per_day} />
            <Detail label="Comment style" value={settings.data.comment_style} />
            <Detail label="Comment approval" value={settings.data.comment_approval} />
            <Detail label="Connection approval" value={settings.data.connection_approval} />
          </dl>
        )}
      </Card>
    </>
  )
}

function Detail({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  )
}
