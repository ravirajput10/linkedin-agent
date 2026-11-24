import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

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
  Select,
  Stat,
  StatusBadge,
} from '@/components/ui'
import { adminApi } from '@/services/api'
import { ApiRequestError } from '@/services/client'
import { formatDateTime } from '@/utils/format'
import type { AdminUser, UserRole } from '@/types/api'

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

export function AdminUsers() {
  const queryClient = useQueryClient()
  const { user: currentUser } = useAuth()

  const [search, setSearch] = useState('')
  const [role, setRole] = useState<'' | UserRole>('')
  const [active, setActive] = useState<'' | 'true' | 'false'>('')
  const [page, setPage] = useState(1)
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)

  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats })

  const filters = {
    page,
    page_size: 25,
    search: search.trim() || undefined,
    role: role || undefined,
    is_active: active === '' ? undefined : active === 'true',
  }

  const users = useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () => adminApi.listUsers(filters),
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin'] })
  }

  const setActiveState = useMutation({
    mutationFn: ({ id, next, reason }: { id: number; next: boolean; reason?: string }) =>
      next ? adminApi.activate(id) : adminApi.deactivate(id, reason),
    onSuccess: () => {
      setActionError(null)
      invalidate()
    },
    onError: setActionError,
  })

  const changeRole = useMutation({
    mutationFn: ({ id, nextRole }: { id: number; nextRole: UserRole }) =>
      adminApi.updateUser(id, { role: nextRole }),
    onSuccess: () => {
      setActionError(null)
      invalidate()
    },
    onError: setActionError,
  })

  const removeUser = useMutation({
    mutationFn: (id: number) => adminApi.removeUser(id),
    onSuccess: () => {
      setActionError(null)
      invalidate()
    },
    onError: setActionError,
  })

  const totalPages = users.data ? Math.max(1, Math.ceil(users.data.total / 25)) : 1

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone with an account. Each user sees only their own campaigns and candidates."
        action={
          <Button variant="primary" onClick={() => setCreating((open) => !open)}>
            {creating ? 'Cancel' : 'Add user'}
          </Button>
        }
      />

      {stats.data && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Total users" value={stats.data.total_users} />
          <Stat
            label="Active"
            value={stats.data.active_users}
            hint={`${stats.data.deactivated_users} deactivated`}
          />
          <Stat
            label="Administrators"
            value={stats.data.admins}
            hint={`${stats.data.new_users_last_7_days} new this week`}
          />
          <Stat
            label="Campaigns"
            value={stats.data.total_campaigns}
            hint={`${stats.data.running_campaigns} running`}
          />
        </div>
      )}

      {creating && <CreateUserCard onDone={() => { setCreating(false); invalidate() }} />}

      <Card title="Accounts">
        <div className="flex flex-wrap gap-3 border-b border-border-subtle p-4">
          <div className="min-w-48 flex-1">
            <Field label="Search">
              <Input
                placeholder="Name, email or company"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                  setPage(1)
                }}
              />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Role">
              <Select
                value={role}
                onChange={(event) => {
                  setRole(event.target.value as '' | UserRole)
                  setPage(1)
                }}
              >
                <option value="">All</option>
                <option value="ADMIN">Admin</option>
                <option value="USER">User</option>
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="Status">
              <Select
                value={active}
                onChange={(event) => {
                  setActive(event.target.value as '' | 'true' | 'false')
                  setPage(1)
                }}
              >
                <option value="">All</option>
                <option value="true">Active</option>
                <option value="false">Deactivated</option>
              </Select>
            </Field>
          </div>
        </div>

        {actionError != null ? (
          <p
            role="alert"
            className="border-b border-border-subtle bg-critical-soft px-4 py-2 text-sm text-critical"
          >
            {errorMessage(actionError)}
          </p>
        ) : null}

        {users.isLoading && <LoadingState />}
        {users.error && <ErrorState error={users.error} onRetry={() => users.refetch()} />}

        {users.data && users.data.items.length === 0 && (
          <EmptyState title="No users match these filters" />
        )}

        {users.data && users.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead className="border-b border-border-subtle text-left text-xs text-ink-faint">
                <tr>
                  <th className="px-4 py-2 font-medium">User</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="tabular px-4 py-2 text-right font-medium">Campaigns</th>
                  <th className="tabular px-4 py-2 text-right font-medium">Candidates</th>
                  <th className="px-4 py-2 font-medium">Last sign-in</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {users.data.items.map((row) => (
                  <UserRow
                    key={row.id}
                    user={row}
                    isSelf={row.id === currentUser?.id}
                    busy={
                      setActiveState.isPending || changeRole.isPending || removeUser.isPending
                    }
                    onToggleActive={(reason) =>
                      setActiveState.mutate({ id: row.id, next: !row.is_active, reason })
                    }
                    onToggleRole={() =>
                      changeRole.mutate({
                        id: row.id,
                        nextRole: row.role === 'ADMIN' ? 'USER' : 'ADMIN',
                      })
                    }
                    onDelete={() => removeUser.mutate(row.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {users.data && totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-sm text-ink-muted">
            <span>
              Page {page} of {totalPages} · {users.data.total} users
            </span>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <Button
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </>
  )
}

function UserRow({
  user,
  isSelf,
  busy,
  onToggleActive,
  onToggleRole,
  onDelete,
}: {
  user: AdminUser
  isSelf: boolean
  busy: boolean
  onToggleActive: (reason?: string) => void
  onToggleRole: () => void
  onDelete: () => void
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  return (
    <tr className="border-b border-border-subtle last:border-0">
      <td className="px-4 py-2.5">
        <Link
          to={`/admin/users/${user.id}`}
          className="font-medium text-ink hover:text-accent hover:underline"
        >
          {user.full_name || user.email}
        </Link>
        <p className="text-xs text-ink-faint">{user.email}</p>
        {isSelf && <Badge className="mt-1">YOU</Badge>}
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge status={user.role} />
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge status={user.status} />
        {user.deactivated_reason && (
          <p className="mt-0.5 max-w-48 truncate text-xs text-ink-faint" title={user.deactivated_reason}>
            {user.deactivated_reason}
          </p>
        )}
      </td>
      <td className="tabular px-4 py-2.5 text-right">
        {user.campaign_count}
        {user.active_campaign_count > 0 && (
          <span className="ml-1 text-xs text-positive">({user.active_campaign_count} live)</span>
        )}
      </td>
      <td className="tabular px-4 py-2.5 text-right">{user.candidate_count}</td>
      <td className="px-4 py-2.5 text-xs text-ink-muted">
        {user.last_login_at ? formatDateTime(user.last_login_at) : 'Never'}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap justify-end gap-1.5">
          <Button
            disabled={busy || isSelf}
            title={isSelf ? 'You cannot deactivate your own account.' : undefined}
            onClick={() =>
              onToggleActive(
                user.is_active
                  ? window.prompt('Reason for deactivating (optional):') ?? undefined
                  : undefined,
              )
            }
          >
            {user.is_active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button disabled={busy} onClick={onToggleRole}>
            {user.role === 'ADMIN' ? 'Make user' : 'Make admin'}
          </Button>
          {confirmingDelete ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  setConfirmingDelete(false)
                  onDelete()
                }}
              >
                Confirm
              </Button>
              <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            </>
          ) : (
            <Button
              variant="ghost"
              disabled={busy || isSelf}
              onClick={() => setConfirmingDelete(true)}
            >
              Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function CreateUserCard({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'USER' as UserRole,
  })

  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim() || undefined,
        role: form.role,
      }),
    onSuccess: onDone,
  })

  return (
    <Card title="New user">
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email">
            <Input
              type="email"
              required
              value={form.email}
              onChange={(event) => setForm({ ...form, email: event.target.value })}
            />
          </Field>
          <Field label="Full name">
            <Input
              value={form.full_name}
              onChange={(event) => setForm({ ...form, full_name: event.target.value })}
            />
          </Field>
          <Field label="Temporary password" hint="Tell them to change it after signing in.">
            <Input
              type="text"
              required
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value as UserRole })}
            >
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </Select>
          </Field>
        </div>

        {create.isError && (
          <p role="alert" className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
            {errorMessage(create.error)}
          </p>
        )}

        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={create.isPending}>
            Create user
          </Button>
        </div>
      </form>
    </Card>
  )
}
