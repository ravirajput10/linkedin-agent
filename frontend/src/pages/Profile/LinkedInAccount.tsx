import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { Badge, Button, Card, LoadingState } from '@/components/ui'
import { agentApi, integrationsApi } from '@/services/api'
import { ApiRequestError } from '@/services/client'
import { formatDateTime } from '@/utils/format'
import type { PlatformAccount, PlatformAccountStatus } from '@/types/api'

const STATUS_TONE: Record<PlatformAccountStatus, 'positive' | 'caution' | 'critical' | 'neutral'> =
{
  CONNECTED: 'positive',
  PENDING: 'caution',
  ERROR: 'critical',
  DISCONNECTED: 'neutral',
  NOT_CONNECTED: 'neutral',
  WARNING: 'caution',
  EXPIRED: 'critical',
}

const STATUS_LABEL: Record<PlatformAccountStatus, string> = {
  CONNECTED: 'CONNECTED',
  PENDING: 'AWAITING SIGN-IN',
  ERROR: 'NEEDS RECONNECTING',
  DISCONNECTED: 'DISCONNECTED',
  NOT_CONNECTED: 'NOT CONNECTED',
  WARNING: 'SECURITY WARNING',
  EXPIRED: 'SESSION EXPIRED',
}

const TIER_NAMES: Record<string, string> = {
  FREE: 'Free Tier',
  PREMIUM: 'Premium Business',
  SALES_NAVIGATOR: 'Sales Navigator',
  RECRUITER: 'Recruiter Lite',
}

function formatLastSeen(isoString?: string | null): string {
  if (!isoString) return 'Never'
  const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000)
  if (diffSec < 60) return 'Just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}

/**
 * Connect the user's own LinkedIn account through Unipile's hosted wizard.
 *
 * We never see their LinkedIn password: the Connect button fetches a one-time
 * link and hands the browser over to Unipile, which hosts the sign-in and
 * calls our webhook when it finishes.
 */
export function LinkedInAccount() {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [notice, setNotice] = useState<{ tone: 'positive' | 'critical'; text: string } | null>(
    null,
  )
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['integrations', 'linkedin'],
    queryFn: integrationsApi.linkedin,
  })

  const { data: agentStatus, refetch: refetchAgentStatus } = useQuery({
    queryKey: ['agent', 'status'],
    queryFn: agentApi.status,
    retry: false,
  })

  /**
   * Ask the server to read the connection's real state back from Unipile.
   *
   * On a deployment with no public webhook address this is what actually binds
   * the account; where a webhook does exist it rescues one that was missed.
   */
  const refresh = useMutation({
    mutationFn: integrationsApi.refreshLinkedIn,
    onSuccess: (account) => queryClient.setQueryData(['integrations', 'linkedin'], account),
  })

  // Unipile sends the browser back here with ?linkedin=connected|failed and/or ?account_id=...
  // The query string only says the member finished the wizard — the server is
  // the one that knows whether an account was bound, so always reconcile.
  useEffect(() => {
    const outcome = params.get('linkedin')
    const accountIdParam = params.get('account_id')
    if (!outcome && !accountIdParam) return

    setNotice(
      outcome === 'failed'
        ? { tone: 'critical', text: 'That LinkedIn connection did not complete.' }
        : { tone: 'positive', text: 'Finishing up…' },
    )

    refresh
      .mutateAsync(accountIdParam ? { account_id: accountIdParam } : undefined)
      .then((account) => {
        if (outcome === 'failed') return
        setNotice(
          account.connected
            ? { tone: 'positive', text: 'LinkedIn connected.' }
            : {
              tone: 'critical',
              text: 'LinkedIn did not finish connecting. Try again.',
            },
        )
      })
      .catch(() => {
        void refetch()
      })

    const next = new URLSearchParams(params)
    next.delete('linkedin')
    next.delete('account_id')
    setParams(next, { replace: true })
    // `refresh` is a stable mutation handle; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, setParams, refetch])

  const connect = useMutation({
    mutationFn: (reconnect: boolean) => integrationsApi.connectLinkedIn(reconnect),
    onSuccess: (link) => {
      // Full navigation, not a new tab: pop-up blockers eat window.open here,
      // and Unipile returns the user to /profile when it is done.
      window.location.href = link.url
    },
  })

  const disconnect = useMutation({
    mutationFn: integrationsApi.disconnectLinkedIn,
    onSuccess: (account) => {
      setConfirmingDisconnect(false)
      setNotice({ tone: 'positive', text: 'LinkedIn disconnected.' })
      queryClient.setQueryData(['integrations', 'linkedin'], account)
    },
  })

  if (isLoading || !data) {
    return (
      <Card title="LinkedIn account">
        <LoadingState />
      </Card>
    )
  }

  return (
    <Card
      title="LinkedIn account"
      action={<Badge tone={STATUS_TONE[data.status]}>{STATUS_LABEL[data.status]}</Badge>}
    >
      <div className="space-y-4 p-4">
        <Explanation account={data} />

        {notice && (
          <p
            role="status"
            className={
              notice.tone === 'positive'
                ? 'rounded-md border border-positive/30 bg-positive-soft px-3 py-2 text-sm text-positive'
                : 'rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical'
            }
          >
            {notice.text}
          </p>
        )}

        {data.last_error && (
          <p
            role="alert"
            className="rounded-md border border-caution/30 bg-caution-soft px-3 py-2 text-sm text-caution"
          >
            {data.last_error}
          </p>
        )}

        {connect.isError && (
          <p
            role="alert"
            className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical"
          >
            {errorMessage(connect.error)}
          </p>
        )}
        {disconnect.isError && (
          <p
            role="alert"
            className="rounded-md border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical"
          >
            {errorMessage(disconnect.error)}
          </p>
        )}

        {!data.linking_enabled && (
          <p className="rounded-md border border-border-subtle bg-surface-muted px-3 py-2 text-sm text-ink-muted">
            LinkedIn connection is not configured on this server yet. Ask an administrator to
            finish the Unipile setup.
          </p>
        )}

        {/* Chrome Extension & Account Type Details */}
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 divide-y divide-slate-100 dark:divide-slate-800 p-3 space-y-2.5">
          {/* Chrome Extension Status */}
          <div className="flex items-center justify-between pt-0.5">
            <div className="min-w-0 pr-3">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                Chrome extension
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {agentStatus?.extension_version ? `v${agentStatus.extension_version}` : 'v1.4.2'} ·{' '}
                {agentStatus?.extension_online
                  ? `Active ${formatLastSeen(agentStatus?.extension_last_seen)}`
                  : agentStatus?.extension_last_seen
                  ? `Last seen ${formatLastSeen(agentStatus?.extension_last_seen)}`
                  : 'Offline / not paired'}
              </p>
            </div>
            <Badge tone={agentStatus?.extension_online ? 'positive' : 'caution'}>
              {agentStatus?.extension_online ? 'Online' : 'Offline'}
            </Badge>
          </div>

          {/* Account Type / Tier */}
          <div className="flex items-center justify-between pt-2.5">
            <div className="min-w-0 pr-3">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">
                Account type
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Detected: {TIER_NAMES[agentStatus?.account_tier?.toUpperCase() || ''] || agentStatus?.account_tier || 'Free Tier'} · limits tuned accordingly
              </p>
            </div>
            <Button
              variant="secondary"
              loading={refresh.isPending}
              onClick={async () => {
                try {
                  const updated = await refresh.mutateAsync(undefined)
                  if (updated.status === 'ERROR' || !updated.connected) {
                    setNotice({
                      tone: 'critical',
                      text: updated.last_error || 'LinkedIn session needs reconnecting.',
                    })
                  } else {
                    setNotice({
                      tone: 'positive',
                      text: 'LinkedIn connection verified and active.',
                    })
                  }
                  void refetchAgentStatus()
                } catch (err) {
                  setNotice({ tone: 'critical', text: errorMessage(err) })
                }
              }}
              className="text-xs h-7 px-3 shrink-0 whitespace-nowrap"
            >
              Re-check
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data.connected || data.status === 'CONNECTED' ? (
            <>
              {confirmingDisconnect ? (
                <>
                  <Button
                    variant="danger"
                    loading={disconnect.isPending}
                    onClick={() => disconnect.mutate()}
                  >
                    Yes, disconnect
                  </Button>
                  <Button onClick={() => setConfirmingDisconnect(false)}>Cancel</Button>
                </>
              ) : (
                <Button variant="secondary" onClick={() => setConfirmingDisconnect(true)}>
                  Disconnect
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              disabled={!data.linking_enabled}
              loading={connect.isPending}
              onClick={() => connect.mutate(data.status === 'ERROR')}
            >
              {data.status === 'ERROR' ? 'Reconnect LinkedIn' : 'Connect LinkedIn'}
            </Button>
          )}
        </div>

        <p className="text-xs text-ink-faint">
          You sign in on LinkedIn&apos;s own page via our provider. Your password is never sent
          to, or stored by, this application.
        </p>
      </div>
    </Card>
  )
}

function Explanation({ account }: { account: PlatformAccount }) {
  if (account.connected || account.status === 'CONNECTED') {
    return (
      <p className="text-sm text-ink-muted">
        Your agent acts through this LinkedIn account
        {account.connected_at ? ` — connected ${formatDateTime(account.connected_at)}` : ''}. Its
        daily limits are your LinkedIn account&apos;s own, so Premium or Sales Navigator is
        effectively required for real volume.
      </p>
    )
  }

  if (account.status === 'ERROR') {
    return (
      <p className="text-sm text-ink-muted">
        LinkedIn signed this session out — that happens when you log in elsewhere. Reconnect to
        resume your campaigns. Nothing is lost in the meantime.
      </p>
    )
  }

  if (account.status === 'PENDING') {
    return (
      <p className="text-sm text-ink-muted">
        A connection was started but not finished. Start again to complete it.
      </p>
    )
  }

  return (
    <p className="text-sm text-ink-muted">
      Connect your LinkedIn account so the agent can act on your behalf. Campaigns cannot run
      until you do.
    </p>
  )
}
