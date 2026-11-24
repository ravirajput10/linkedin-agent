import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Textarea } from '@/components/ui'
import { CriteriaEditor } from '@/pages/CreateCampaign/CriteriaEditor'
import { campaignsApi } from '@/services/api'
import type { Criteria } from '@/types/api'

const EXAMPLE = `Find CTOs, VPs of Engineering, Engineering Managers and senior Java developers working in SaaS/software companies in India.

Focus on people who actively post about Java, Spring Boot, AI, Generative AI, microservices, software architecture and engineering leadership.

Ignore recruitment posts, job advertisements, generic motivational posts, spam and purely promotional content.

Like their first two relevant posts. On the third relevant post, evaluate it with AI and, if it is meaningful, like it and generate a short technical comment.

After two days, re-check the person and send a personalized connection request if they are still eligible.

Process up to 20 people per day.`

export function AdminCreateCampaign() {
  const navigate = useNavigate()

  const [instruction, setInstruction] = useState('')
  const [name, setName] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [criteria, setCriteria] = useState<Criteria | null>(null)
  const [summary, setSummary] = useState('')
  const [parserInfo, setParserInfo] = useState<{ provider: string; model: string; version: string } | null>(
    null,
  )

  const analyze = useMutation({
    mutationFn: () => campaignsApi.analyze(instruction),
    onSuccess: (result) => {
      setCriteria(result.criteria)
      setName((current) => current || result.suggested_name)
      setSummary(result.summary)
      setParserInfo({
        provider: result.provider,
        model: result.model,
        version: result.prompt_version,
      })
    },
  })

  const save = useMutation({
    mutationFn: async ({ start }: { start: boolean }) => {
      const campaign = await campaignsApi.create({
        name,
        instruction,
        dry_run: dryRun,
        criteria: criteria ?? undefined,
      })
      if (start) {
        await campaignsApi.start(campaign.id)
      }
      return campaign
    },
    onSuccess: (campaign) => navigate(`/admin/campaigns/${campaign.id}`),
  })

  return (
    <>
      <PageHeader
        title="Create campaign"
        description="Describe who you want to reach. The agent turns it into structured criteria that you review before anything runs."
      />

      <Card title="1. Tell the agent what you are looking for">
        <Textarea
          rows={8}
          value={instruction}
          placeholder={EXAMPLE}
          aria-label="Campaign instruction"
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            loading={analyze.isPending}
            disabled={instruction.trim().length < 10}
            onClick={() => analyze.mutate()}
          >
            Analyze Requirements
          </Button>
          <Button
            variant="ghost"
            onClick={() => setInstruction(EXAMPLE)}
            disabled={analyze.isPending}
          >
            Use the example
          </Button>
          {parserInfo && (
            <span className="text-xs text-ink-faint">
              Parsed by {parserInfo.provider} ({parserInfo.model}), prompt {parserInfo.version}
            </span>
          )}
        </div>

        {analyze.isError && (
          <div className="mt-3">
            <ErrorState error={analyze.error} onRetry={() => analyze.mutate()} />
          </div>
        )}
      </Card>

      {criteria && (
        <>
          <Card title="2. Review what the agent understood">
            {summary && <p className="mb-4 text-sm text-ink-muted">{summary}</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Campaign name">
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <div>
                <p className="mb-1 text-xs font-medium text-ink-muted">Execution mode</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={dryRun}
                      onChange={(event) => setDryRun(event.target.checked)}
                      className="size-4 rounded border-border-subtle text-accent focus:ring-accent/30"
                    />
                    Dry run
                  </label>
                  {dryRun ? (
                    <Badge tone="caution">Nothing is sent to the platform</Badge>
                  ) : (
                    <Badge tone="positive">Actions are executed for real</Badge>
                  )}
                </div>
              </div>
            </div>
          </Card>

          <CriteriaEditor criteria={criteria} onChange={setCriteria} />

          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                loading={save.isPending && save.variables?.start === true}
                disabled={!name.trim()}
                onClick={() => save.mutate({ start: true })}
              >
                Start Campaign
              </Button>
              <Button
                loading={save.isPending && save.variables?.start === false}
                disabled={!name.trim()}
                onClick={() => save.mutate({ start: false })}
              >
                Save Draft
              </Button>
              <Button variant="ghost" onClick={() => navigate('/admin/campaigns')}>
                Cancel
              </Button>
            </div>
            {save.isError && (
              <div className="mt-3">
                <ErrorState error={save.error} />
              </div>
            )}
          </Card>
        </>
      )}
    </>
  )
}
