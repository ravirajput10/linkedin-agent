import { useQuery } from '@tanstack/react-query'

import {
  Badge,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  TagList,
} from '@/components/ui'
import { settingsApi } from '@/services/api'
import { humanize } from '@/utils/format'

const SUPPORT_TONES = {
  SUPPORTED: 'positive',
  MANUAL_REQUIRED: 'caution',
  UNSUPPORTED: 'critical',
} as const

export function AdminSettings() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  if (isLoading) return <LoadingState />
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />

  return (
    <>
      <PageHeader
        title="Settings"
        description="Server configuration, read-only. Secrets are never sent to the browser."
      />

      <Card
        title="AI provider"
        action={
          data.dry_run ? <Badge tone="caution">DRY RUN</Badge> : <Badge tone="positive">LIVE</Badge>
        }
      >
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Detail label="Provider" value={data.llm.provider} />
          <Detail label="Model" value={data.llm.model} />
          <Detail label="Environment" value={data.app_env} />
          <Detail
            label="Max context"
            value={`${data.llm.max_context_tokens.toLocaleString()} tokens`}
          />
          <Detail label="Platform adapter" value={data.platform} />
          <Detail label="Connection delay" value={`${data.connection_delay_hours} hours`} />
        </dl>

        <div className="mt-4">
          <p className="mb-1.5 text-xs font-medium text-ink-muted">Model capabilities</p>
          <div className="flex flex-wrap gap-1.5">
            <Capability label="Structured output" enabled={data.llm.supports_structured_output} />
            <Capability label="Tool calling" enabled={data.llm.supports_tool_calling} />
            <Capability label="Streaming" enabled={data.llm.supports_streaming} />
            <Capability label="Vision" enabled={data.llm.supports_vision} />
          </div>
        </div>

        {/* <p className="mt-4 text-xs text-ink-faint">
          Switch providers with <code className="text-ink-muted">LLM_PROVIDER</code> in the active
          env file — <code className="text-ink-muted">claude</code>,{' '}
          <code className="text-ink-muted">local</code> or <code className="text-ink-muted">mock</code>.
          No application code changes.
        </p> */}
      </Card>

      <Card title="Platform capabilities">
        <p className="mb-3 text-sm text-ink-muted">
          What the configured adapter can actually do. Unsupported operations are recorded as
          skipped steps rather than worked around.
        </p>
        <ul className="divide-y divide-border-subtle">
          {data.platform_capabilities.map((capability) => (
            <li key={capability.capability} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">
                  {humanize(capability.capability)}
                </span>
                <Badge
                  tone={
                    SUPPORT_TONES[capability.support as keyof typeof SUPPORT_TONES] ?? 'neutral'
                  }
                >
                  {capability.support.replace(/_/g, ' ')}
                </Badge>
              </div>
              {capability.note && (
                <p className="mt-1 text-xs text-ink-muted">{capability.note}</p>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Agent prompts">
        <p className="mb-3 text-sm text-ink-muted">
          Prompts live as versioned Markdown under{' '}
          <code className="text-ink">backend/app/ai/prompts/</code>. Editing a file changes agent
          behaviour without touching Python.
        </p>
        <ul className="divide-y divide-border-subtle">
          {data.prompts.map((prompt) => (
            <li key={prompt.agent_name} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{humanize(prompt.agent_name)}</span>
                <Badge tone="accent">{prompt.version}</Badge>
                {prompt.system_prompt_exists && prompt.user_prompt_exists ? (
                  <Badge tone="positive">Loaded</Badge>
                ) : (
                  <Badge tone="critical">Missing file</Badge>
                )}
              </div>
              {prompt.common_includes.length > 0 && (
                <p className="mt-1 text-xs text-ink-faint">
                  Composed with: {prompt.common_includes.join(', ')}
                </p>
              )}
              <div className="mt-2">
                <p className="mb-1 text-xs font-medium text-ink-muted">Runtime variables</p>
                <TagList values={prompt.user_variables} emptyLabel="None" />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Rate limits">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(data.limits).map(([key, value]) => (
            <Detail key={key} label={humanize(key)} value={String(value)} />
          ))}
        </dl>
        <p className="mt-3 text-xs text-ink-faint">
          These are the server defaults. Each campaign carries its own limits, editable on the
          campaign page.
        </p>
      </Card>
    </>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <Badge tone={enabled ? 'positive' : 'neutral'}>{enabled ? `${label} ✓` : label}</Badge>
}
