import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, useEffect } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'

import { useOptionalAuth } from '@/auth/AuthContext'
import { AlertCircle, MessageSquare, RefreshCw, Sparkles, UserCheck, X } from 'lucide-react'
import { Badge, Button, Card, ErrorState, Field, Input, PageHeader, Textarea } from '@/components/ui'
import { PlanUpgradeModal } from '@/components/billing/PlanUpgradeModal'
import { CAMPAIGN_TEMPLATES } from '@/data/campaignTemplates'
import { CriteriaEditor } from '@/pages/CreateCampaign/CriteriaEditor'
import { audiencesApi, campaignsApi } from '@/services/api'
import type { Criteria } from '@/types/api'

const EXAMPLE = `Find CTOs, VPs of Engineering, Engineering Managers and senior Java developers working in SaaS/software companies in India.

Focus on people who actively post about Java, Spring Boot, AI, Generative AI, microservices, software architecture and engineering leadership.

Ignore recruitment posts, job advertisements, generic motivational posts, spam and purely promotional content.

Like their first two relevant posts. On the third relevant post, evaluate it with AI and, if it is meaningful, like it and generate a short technical comment.

After two days, re-check the person and send a personalized connection request if they are still eligible.

Process up to 20 people per day.`

export function CreateCampaign() {
  const auth = useOptionalAuth()
  if (auth?.isAdmin) {
    return <Navigate to="/admin/campaigns/new" replace />
  }

  const navigate = useNavigate()
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const templateParam = searchParams.get('template')

  const [instruction, setInstruction] = useState('')
  const [name, setName] = useState('')
  const [dryRun, setDryRun] = useState(true)
  const [selectedAudienceId, setSelectedAudienceId] = useState<number | null>(null)
  const [criteria, setCriteria] = useState<Criteria | null>(null)
  const [summary, setSummary] = useState('')
  const [parserInfo, setParserInfo] = useState<{ provider: string; model: string; version: string } | null>(
    null,
  )
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewTone, setPreviewTone] = useState<'Thoughtful peer' | 'Executive' | 'Challenger' | 'Curious'>('Thoughtful peer')
  const [previewIndex, setPreviewIndex] = useState(0)

  const PREVIEW_PERSONAS = [
    {
      name: 'Priya Sharma',
      headline: 'VP of Engineering at FinScale · Microservices & Platform',
      postSnippet: 'We migrated our payment settlement engine from RabbitMQ to Apache Kafka with per-tenant partitions. Isolation has improved 10x, but managing partition rebalances during peak flash sales has been tricky.',
      scores: { relevance: 94, candidate: 88 },
      topics: ['Kafka', 'Microservices', 'Distributed Systems'],
      drafts: {
        'Thoughtful peer': 'Strong point on per-tenant partition isolation, Priya — we ran into similar partition rebalance pauses on consumer groups during traffic spikes. Did switching to cooperative sticky assignors smooth that out for you?',
        'Executive': 'Decoupling multi-tenant financial workloads at the partition layer is foundational for enterprise SLAs. Great operational transparency on Kafka scaling realities.',
        'Challenger': 'Per-tenant partitioning delivers clean isolation, but tenant counts beyond a few hundred risk partition explosion and metadata saturation. Have you evaluated hash-slotted topics instead?',
        'Curious': 'Fascinating breakdown on the migration! How are you monitoring end-to-end lag across individual tenant partitions during flash-sale bursts?',
      },
    },
    {
      name: 'David Vance',
      headline: 'CTO at CloudOps SaaS · GenAI Platform & Infra',
      postSnippet: 'Most engineering teams jump straight to fine-tuning LLMs when they hit accuracy walls. In 90% of production rollouts, rigorous offline evaluation harnesses and guardrail prompt stages outperform fine-tuning by a mile.',
      scores: { relevance: 96, candidate: 91 },
      topics: ['GenAI', 'LLM Evals', 'Prompt Architecture'],
      drafts: {
        'Thoughtful peer': 'Spot on, David — offline regression suites caught 80% of our prompt regressions before anything touched live users. How do you calibrate your eval datasets when user query patterns shift?',
        'Executive': 'Pragmatic guidance for engineering leaders. Guardrails and eval-driven pipelines protect brand trust far more cost-effectively than custom fine-tunes.',
        'Challenger': 'Offline evals are essential, but offline synthetic benchmarks still miss real multi-turn edge cases. Do you run shadow traffic in parallel before promoting models?',
        'Curious': 'Great observation! What automated threshold or eval benchmark do you mandate before a new prompt version gets green-lit for production traffic?',
      },
    },
  ]
  const currentPreview = PREVIEW_PERSONAS[previewIndex % PREVIEW_PERSONAS.length]


  useEffect(() => {
    if (templateParam) {
      const matched = CAMPAIGN_TEMPLATES.find((t) => t.id === templateParam)
      if (matched) {
        setName(matched.name)
        setInstruction(matched.instruction)
      }
    }
  }, [templateParam])

  // Fetch live audiences from FR-2
  const { data: dbAudiences = [] } = useQuery({
    queryKey: ['audiences'],
    queryFn: () => audiencesApi.list(),
  })

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
        audience_id: selectedAudienceId ?? undefined,
        criteria: criteria ?? undefined,
      })
      if (start) {
        await campaignsApi.start(campaign.id)
      }
      return campaign
    },
    onSuccess: (campaign) => navigate(`/campaigns/${campaign.id}`),
  })


  return (
    <>
      <PageHeader
        title="Create campaign"
        description="Describe who you want to reach. The agent turns it into structured criteria that you review before anything runs."
      />

      <Card title="1. Select Target Audience & Instructions">
        {dbAudiences.length > 0 && (
          <div className="mb-3.5 space-y-1">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Target Audience (Optional)
            </label>
            <select
              value={selectedAudienceId ?? ''}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null
                setSelectedAudienceId(val)
                if (val) {
                  const matched = dbAudiences.find((a) => a.id === val)
                  if (matched?.original_prompt) {
                    setInstruction(matched.original_prompt)
                  }
                  if (matched?.name && !name) {
                    setName(`${matched.name} Outreach`)
                  }
                }
              }}
              className="w-full h-9 px-3 text-xs sm:text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
            >
              <option value="">-- Choose from your saved audiences --</option>
              {dbAudiences.map((aud) => (
                <option key={aud.id} value={aud.id}>
                  {aud.name} ({aud.people_count} prospects)
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400">
              Selecting a saved audience links its discovered prospects directly into this campaign.
            </p>
          </div>
        )}

        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
          Campaign instructions
        </label>
        <Textarea
          rows={7}
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
            type="button"
            variant="secondary"
            onClick={() => setIsPreviewOpen(true)}
            className="flex items-center gap-1.5 border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 text-[#2445C8] dark:text-blue-400 hover:bg-blue-50"
          >
            <Sparkles className="size-3.5" />
            <span>Preview Sample AI Draft</span>
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
              <Button variant="ghost" onClick={() => navigate('/campaigns')}>
                Cancel
              </Button>
            </div>
            {save.isError && (() => {
              const err = save.error as { code?: string; status?: number; message?: string }
              const isQuota =
                err?.code === 'QUOTA_EXCEEDED' ||
                err?.status === 402 ||
                err?.message?.toLowerCase().includes('limit')

              if (isQuota) {
                return (
                  <div className="mt-4 p-5 rounded-2xl bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 border border-blue-200/80 dark:border-blue-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-4 animate-in fade-in">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-blue-600 text-white shrink-0 shadow-xs">
                        <Sparkles className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                          Campaign Plan Limit Reached
                        </h4>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-lg leading-relaxed">
                          {save.error instanceof Error ? save.error.message : 'You have reached the maximum number of campaigns allowed on your current plan.'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 shrink-0">
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => setIsUpgradeModalOpen(true)}
                        className="text-xs font-semibold h-9 px-4 gap-1.5 shadow-sm"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Upgrade Plan</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => navigate('/campaigns')}
                        className="text-xs text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white h-9"
                      >
                        View Campaigns
                      </Button>
                    </div>
                  </div>
                )
              }

              const isGlobalPaused = err?.message?.toLowerCase().includes('globally paused')
              if (isGlobalPaused) {
                return (
                  <div className="mt-4 p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 shrink-0">
                        <AlertCircle className="h-5 w-5" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                          Automation is Globally Paused
                        </h4>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 max-w-lg">
                          All outbound actions are currently held by your safety switch. You can save this campaign as a draft now, or resume automation in Settings.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => save.mutate({ start: false })}
                        className="text-xs h-8"
                      >
                        Save as Draft
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => navigate('/settings')}
                        className="text-xs h-8"
                      >
                        Open Settings
                      </Button>
                    </div>
                  </div>
                )
              }

              return (
                <div className="mt-3">
                  <ErrorState error={save.error} />
                </div>
              )
            })()}
          </Card>
        </>
      )}

      {/* SAMPLE AI DRAFT PREVIEW MODAL (FR-4.6) */}
      {isPreviewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
        >
          <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-[#2445C8] dark:text-blue-400 flex items-center justify-center">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                    Sample AI Comment & Candidate Preview
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    See how your campaign instructions evaluate prospect posts and draft comments
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-muted text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Target Candidate Mock */}
            <div className="rounded-xl border border-slate-200/80 dark:border-border p-3.5 bg-slate-50/50 dark:bg-muted/10 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                      {currentPreview.name}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/60">
                      <UserCheck className="size-3" />
                      {currentPreview.scores.candidate}% fit match
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {currentPreview.headline}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setPreviewIndex((i) => i + 1)}
                  className="text-xs h-7 gap-1"
                >
                  <RefreshCw className="size-3" />
                  <span>Try another prospect</span>
                </Button>
              </div>

              {/* Mock LinkedIn Post */}
              <div className="rounded-lg bg-white dark:bg-card border border-slate-200/60 dark:border-border p-3 text-xs text-slate-700 dark:text-slate-300">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Evaluated Target Post (#{currentPreview.scores.relevance}% relevance)
                </span>
                <p className="leading-relaxed font-normal">{currentPreview.postSnippet}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {currentPreview.topics.map((t) => (
                    <span
                      key={t}
                      className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-300"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Tone Selector & Generated Draft */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <MessageSquare className="size-3.5 text-[#2445C8]" />
                  <span>AI Comment Draft by Persona Tone:</span>
                </label>
                <span className="text-[11px] text-slate-400">
                  {currentPreview.drafts[previewTone].length} characters
                </span>
              </div>

              {/* Tone switcher pills */}
              <div className="flex flex-wrap gap-1.5">
                {(['Thoughtful peer', 'Executive', 'Challenger', 'Curious'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setPreviewTone(t)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      previewTone === t
                        ? 'bg-[#2445C8] text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Generated Comment Box */}
              <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 p-3.5">
                <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-100 leading-relaxed font-mono">
                  {currentPreview.drafts[previewTone]}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
                  Guardrails applied: No sales pitch, no external links, contextually anchored to author's specific post.
                </p>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-border">
              <Button type="button" variant="ghost" onClick={() => setIsPreviewOpen(false)}>
                Close Preview
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setIsPreviewOpen(false)
                  if (!criteria) {
                    analyze.mutate()
                  }
                }}
              >
                Proceed with Campaign
              </Button>
            </div>
          </div>
        </div>
      )}

      {isUpgradeModalOpen && (
        <PlanUpgradeModal
          isOpen={isUpgradeModalOpen}
          onClose={() => setIsUpgradeModalOpen(false)}
        />
      )}
    </>
  )
}
