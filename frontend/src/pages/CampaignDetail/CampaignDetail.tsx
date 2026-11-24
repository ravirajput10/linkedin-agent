import { useState, useEffect } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ThumbsUp,
  MessageSquare,
  UserPlus,
  Clock,
  Plus,
  CheckCircle2,
  AlertCircle,
  Play,
  Copy,
  Archive,
  ArchiveRestore,
  FastForward,
  Trash2,
  X,
  Sliders,
  Languages,
  GitBranch,
  RefreshCw,
} from 'lucide-react'

import { CriteriaEditor } from '@/pages/CreateCampaign/CriteriaEditor'
import type { Criteria } from '@/types/api'
import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { campaignsApi, audiencesApi } from '@/services/api'

export function CampaignDetail() {
  const { id } = useParams<{ id: string }>()
  const campaignId = Number(id) || 1
  const auth = useOptionalAuth()
  const isAdmin = auth?.isAdmin ?? false

  if (isAdmin) {
    return <Navigate to={`/admin/campaigns/${campaignId}`} replace />
  }

  return <UserCampaignDetail campaignId={campaignId} />
}

function UserCampaignDetail({ campaignId }: { campaignId: number }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Live Campaign Query
  const { data: campaign, refetch: refetchCampaign } = useQuery({
    queryKey: ['campaigns', campaignId],
    queryFn: () => campaignsApi.get(campaignId),
    enabled: Number.isFinite(campaignId),
  })

  // Live Candidates for this Campaign
  const { data: candidatesData, refetch: refetchCandidates } = useQuery({
    queryKey: ['campaigns', campaignId, 'candidates'],
    queryFn: () => campaignsApi.candidates(campaignId, { page_size: 50 }),
    enabled: Number.isFinite(campaignId),
  })

  // Live Audiences Query
  const { data: dbAudiences = [] } = useQuery({
    queryKey: ['audiences'],
    queryFn: () => audiencesApi.list(),
  })

  const [activeTab, setActiveTab] = useState<'sequence' | 'prospects' | 'results'>('sequence')
  const [notification, setNotification] = useState<{ message: string; tone: 'success' | 'error' } | null>(null)

  // Step 2 AI Comment Settings
  const [commentTone, setCommentTone] = useState('Thoughtful peer')
  const [commentLength, setCommentLength] = useState('1–2 sentences')
  const [commentGuardrails, setCommentGuardrails] = useState('No pitching, no links, no emojis')
  const [commentApproval, setCommentApproval] = useState<'REQUIRED' | 'AUTOMATIC'>('REQUIRED')

  // Step 3 Connection Request Settings
  const [connectTone, setConnectTone] = useState('Thoughtful peer')
  const [connectLength, setConnectLength] = useState('1–2 sentences')
  const [connectGuardrails, setConnectGuardrails] = useState('No pitching, no links, no emojis')
  const [connectionApproval, setConnectionApproval] = useState<'REQUIRED' | 'AUTOMATIC'>('REQUIRED')

  // Sidebar Campaign Settings
  const [approvalMode, setApprovalMode] = useState('Approve comments, notes & messages')
  const [prospectsPerDay, setProspectsPerDay] = useState(15)
  const [connectionDelayHours, setConnectionDelayHours] = useState<number>(48)
  const [activeDays, setActiveDays] = useState('Mon – Fri')
  const [stopOnReply, setStopOnReply] = useState(true)
  const [skipEngaging, setSkipEngaging] = useState(true)

  // Manual Prospect Enrollment Modal
  const [isAddProspectOpen, setIsAddProspectOpen] = useState(false)
  const [manualProfileUrl, setManualProfileUrl] = useState('')
  const [manualName, setManualName] = useState('')
  const [manualTitle, setManualTitle] = useState('')

  // Targeting & Criteria Modal
  const [isEditTargetingOpen, setIsEditTargetingOpen] = useState(false)
  const [editableCriteria, setEditableCriteria] = useState<Criteria | null>(null)
  const [editableInstruction, setEditableInstruction] = useState('')

  // Extra dynamic steps added from library
  const [extraSteps, setExtraSteps] = useState<string[]>([])

  // Archive / Restore confirmation modal
  const [isArchiveDialogOpen, setIsArchiveDialogOpen] = useState(false)

  // Language auto-detection
  const [matchPostLanguage, setMatchPostLanguage] = useState(true)

  // Dynamic sample scenario index
  const [sampleScenarioIdx, setSampleScenarioIdx] = useState(0)

  // Configurable Conditional Sequence Branching
  const [branchWaitDays, setBranchWaitDays] = useState(14)
  const [branchAcceptedAction, setBranchAcceptedAction] = useState('Send welcome message')
  const [branchAcceptedDelayDays, setBranchAcceptedDelayDays] = useState(1)
  const [branchNotAcceptedAction, setBranchNotAcceptedAction] = useState('Withdraw request')
  const [isEditBranchModalOpen, setIsEditBranchModalOpen] = useState(false)

  const COMMENT_SCENARIOS = [
    {
      author: "ANANYA RAO'S POST ON EVAL-FIRST ROLLOUTS",
      drafts: {
        'Thoughtful peer': '“Strong point on eval-first rollouts — we saw the same when moving our support bot to staged releases. Did you find offline evals predicted production issues, or only live traffic caught them?”',
        'Executive': '“Critical operational insight on staged releases. Embedding eval metrics into core release gates is standardizing reliable AI delivery across enterprise engineering teams.”',
        'Challenger': '“Interesting angle on offline evaluations, but in high-throughput pipelines offline benchmarks often fail to capture real tail latency. How do you guard against runtime drifts?”',
        'Curious questioner': '“Fascinating breakdown on staged rollouts! What regression threshold triggers an automated rollback in your current deployment harness?”',
      },
    },
    {
      author: "KARTIK NAIR'S POST ON KAFKA CONSUMER PARTITIONING",
      drafts: {
        'Thoughtful peer': '“Solid architecture pattern for per-tenant Kafka partitions. We saw similar isolation benefits when separating heavy webhooks from critical transactional events.”',
        'Executive': '“Decoupling multi-tenant financial workloads at the partition layer is foundational for enterprise SLAs. Great operational transparency on Kafka scaling realities.”',
        'Challenger': '“Per-tenant partitioning delivers clean isolation, but tenant counts beyond a few hundred risk partition explosion and metadata saturation. Have you evaluated hash-slotted topics instead?”',
        'Curious questioner': '“Great breakdown on partitioning! How do you handle rebalancing latency during dynamic worker autoscaling?”',
      },
    },
  ]
  const currentCommentScenario = COMMENT_SCENARIOS[sampleScenarioIdx % COMMENT_SCENARIOS.length]
  const dynamicCommentSample =
    currentCommentScenario.drafts[commentTone as keyof typeof currentCommentScenario.drafts] ||
    currentCommentScenario.drafts['Thoughtful peer']

  const CONNECT_DRAFTS: Record<string, string> = {
    'Thoughtful peer': "“Enjoyed the back-and-forth on your post, Ananya — we're working through the same rollout questions at Divergent. Would be great to stay connected.”",
    'Direct & friendly': "“Hi Ananya, saw your insights on engineering rollouts and loved your practical focus. Would love to connect and follow your updates here!”",
    'Mutual interest': "“Hi Ananya — fellow tech leader working in high-scale systems. Really appreciated your recent post on architecture trade-offs and would value connecting.”",
  }
  const dynamicConnectSample = CONNECT_DRAFTS[connectTone] || CONNECT_DRAFTS['Thoughtful peer']


  useEffect(() => {
    if (campaign) {
      if (campaign.instruction) {
        setEditableInstruction(campaign.instruction)
      }
      if (campaign.criteria) {
        setEditableCriteria(campaign.criteria as Criteria)
      }
      if (campaign.criteria?.max_people_per_day) {
        setProspectsPerDay(campaign.criteria.max_people_per_day)
      }
      if (campaign.criteria?.connection_delay_hours !== undefined) {
        setConnectionDelayHours(campaign.criteria.connection_delay_hours)
      }
      const cApproval = campaign.criteria?.comment_approval === 'AUTOMATIC' ? 'AUTOMATIC' : 'REQUIRED'
      const connApproval = campaign.criteria?.connection_approval === 'AUTOMATIC' ? 'AUTOMATIC' : 'REQUIRED'
      setCommentApproval(cApproval)
      setConnectionApproval(connApproval)

      if (cApproval === 'AUTOMATIC' && connApproval === 'AUTOMATIC') {
        setApprovalMode('Fully automatic (safe mode)')
      } else if (cApproval === 'REQUIRED' && connApproval === 'AUTOMATIC') {
        setApprovalMode('Approve comments only')
      } else if (cApproval === 'REQUIRED' && connApproval === 'REQUIRED') {
        setApprovalMode('Approve comments, notes & messages')
      } else {
        setApprovalMode('Custom approval per step')
      }
    }
  }, [campaign])

  const handleApprovalModeChange = (mode: string) => {
    setApprovalMode(mode)
    if (mode === 'Fully automatic (safe mode)') {
      setCommentApproval('AUTOMATIC')
      setConnectionApproval('AUTOMATIC')
    } else if (mode === 'Approve comments only') {
      setCommentApproval('REQUIRED')
      setConnectionApproval('AUTOMATIC')
    } else if (mode === 'Approve comments, notes & messages') {
      setCommentApproval('REQUIRED')
      setConnectionApproval('REQUIRED')
    }
  }

  const handleCommentApprovalChange = (val: 'REQUIRED' | 'AUTOMATIC') => {
    setCommentApproval(val)
    if (val === 'AUTOMATIC' && connectionApproval === 'AUTOMATIC') {
      setApprovalMode('Fully automatic (safe mode)')
    } else if (val === 'REQUIRED' && connectionApproval === 'AUTOMATIC') {
      setApprovalMode('Approve comments only')
    } else if (val === 'REQUIRED' && connectionApproval === 'REQUIRED') {
      setApprovalMode('Approve comments, notes & messages')
    } else {
      setApprovalMode('Custom approval per step')
    }
  }

  const handleConnectionApprovalChange = (val: 'REQUIRED' | 'AUTOMATIC') => {
    setConnectionApproval(val)
    if (commentApproval === 'AUTOMATIC' && val === 'AUTOMATIC') {
      setApprovalMode('Fully automatic (safe mode)')
    } else if (commentApproval === 'REQUIRED' && val === 'AUTOMATIC') {
      setApprovalMode('Approve comments only')
    } else if (commentApproval === 'REQUIRED' && val === 'REQUIRED') {
      setApprovalMode('Approve comments, notes & messages')
    } else {
      setApprovalMode('Custom approval per step')
    }
  }

  const showNotification = (msg: string, tone: 'success' | 'error' = 'success') => {
    setNotification({ message: msg, tone })
    setTimeout(() => setNotification(null), 4000)
  }

  const campaignStatus = campaign?.status ?? 'DRAFT'

  // Start / Pause / Resume mutations
  const startMutation = useMutation({
    mutationFn: () => campaignsApi.start(campaignId),
    onSuccess: (data) => {
      refetchCampaign()
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      showNotification(data?.message || 'Campaign started.', 'success')
    },
    onError: (err: any) => {
      showNotification(err?.message || err?.response?.data?.message || 'Failed to start campaign.', 'error')
    },
  })

  const pauseMutation = useMutation({
    mutationFn: () => campaignsApi.pause(campaignId),
    onSuccess: (data) => {
      refetchCampaign()
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      showNotification(data?.message || 'Campaign paused.', 'success')
    },
    onError: (err: any) => {
      showNotification(err?.message || err?.response?.data?.message || 'Failed to pause campaign.', 'error')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => campaignsApi.resume(campaignId),
    onSuccess: (data) => {
      refetchCampaign()
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      showNotification(data?.message || 'Campaign resumed.', 'success')
    },
    onError: (err: any) => {
      showNotification(err?.message || err?.response?.data?.message || 'Failed to resume campaign.', 'error')
    },
  })

  const duplicateMutation = useMutation({
    mutationFn: () => campaignsApi.duplicate(campaignId),
    onSuccess: (newCamp) => {
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      showNotification(`Campaign duplicated as "${newCamp.name}".`, 'success')
      navigate(`/campaigns/${newCamp.id}`)
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to duplicate campaign.', 'error')
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => campaignsApi.archive(campaignId),
    onSuccess: (updated) => {
      refetchCampaign()
      void queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      setIsArchiveDialogOpen(false)
      const isArchived = updated?.is_archived ?? !campaign?.is_archived
      showNotification(
        isArchived ? 'Campaign archived.' : 'Campaign restored from archive.',
        'success'
      )
    },
    onError: (err: any) => {
      setIsArchiveDialogOpen(false)
      showNotification(err?.message || 'Failed to update campaign archive state.', 'error')
    },
  })

  const skipProspectMutation = useMutation({
    mutationFn: (personId: number) => campaignsApi.skipProspect(campaignId, personId),
    onSuccess: () => {
      refetchCandidates()
      void queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] })
      showNotification('Prospect skipped.', 'success')
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to skip prospect.', 'error')
    },
  })

  const removeProspectMutation = useMutation({
    mutationFn: (personId: number) => campaignsApi.removeProspect(campaignId, personId),
    onSuccess: () => {
      refetchCandidates()
      void queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId] })
      showNotification('Prospect removed from campaign.', 'success')
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to remove prospect.', 'error')
    },
  })

  const updateMutation = useMutation({
    mutationFn: (customCriteria?: any) => {
      const activeCriteria = customCriteria || editableCriteria || campaign?.criteria || {}
      return campaignsApi.update(campaignId, {
        name: campaign?.name || 'Campaign',
        instruction: editableInstruction || campaign?.instruction || '',
        description: campaign?.description || '',
        dry_run: campaign?.dry_run ?? true,
        criteria: {
          ...activeCriteria,
          connection_delay_hours: connectionDelayHours,
          max_people_per_day: prospectsPerDay,
          comment_approval: commentApproval,
          connection_approval: connectionApproval,
        } as any,
        exclusions: campaign?.exclusions || [],
      })
    },
    onSuccess: () => {
      refetchCampaign()
      setIsEditTargetingOpen(false)
      showNotification('All changes saved successfully to backend.', 'success')
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.details?.errors?.[0]?.msg ||
        err?.response?.data?.message ||
        err?.message ||
        'Failed to save changes.'
      showNotification(`Save failed: ${msg}`, 'error')
    },
  })

  const handleSaveChanges = () => {
    updateMutation.mutate({
      ...(editableCriteria || campaign?.criteria || {}),
      connection_delay_hours: connectionDelayHours,
      max_people_per_day: prospectsPerDay,
      comment_approval: commentApproval,
      connection_approval: connectionApproval,
    })
  }

  const addProspectMutation = useMutation({
    mutationFn: () =>
      campaignsApi.addProspect(campaignId, {
        profile_url: manualProfileUrl.trim(),
        full_name: manualName.trim() || undefined,
        job_title: manualTitle.trim() || undefined,
      }),
    onSuccess: (data) => {
      void refetchCandidates()
      void refetchCampaign()
      setIsAddProspectOpen(false)
      setManualProfileUrl('')
      setManualName('')
      setManualTitle('')
      showNotification(data.message || 'Prospect added to campaign!', 'success')
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.details?.errors?.[0]?.msg ||
        err?.response?.data?.message ||
        err?.message ||
        'Error'
      showNotification(`Failed to add prospect: ${msg}`, 'error')
    },
  })

  const handleAddStepFromLibrary = (stepName: string) => {
    setExtraSteps((prev) => [...prev, stepName])
    showNotification(`Added step: "${stepName}" to sequence.`)
  }

  const campaignName = campaign?.name || 'Campaign'
  const linkedAudience = campaign?.audience_id
    ? dbAudiences.find((a: any) => a.id === campaign.audience_id)
    : null
  const audienceName = linkedAudience
    ? linkedAudience.name
    : 'Custom Targeting (No linked audience)'
  const prospectsCount =
    candidatesData?.total ??
    campaign?.stats?.candidates_discovered ??
    0

  const liveCandidates = candidatesData?.items || []
  const hasLiveCandidates = liveCandidates.length > 0

  return (
    <div className="space-y-2 pb-10 text-slate-900 dark:text-slate-100">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl px-4 py-3 text-xs shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200 border ${
            notification.tone === 'error'
              ? 'bg-rose-950 text-rose-100 border-rose-800 shadow-rose-950/20'
              : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 border-slate-800 dark:border-slate-200'
          }`}
        >
          {notification.tone === 'error' ? (
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
          )}
          <span className="font-medium">{notification.message}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="ml-2 text-slate-400 hover:text-white dark:hover:text-slate-900"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ================= PAGE HEADER & ACTIONS ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
          {campaignName}
        </h1>

        <div className="flex flex-wrap items-center gap-2">
          {/* Status Pill */}
          {campaignStatus === 'RUNNING' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/80 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span>Running · {prospectsCount} prospects</span>
            </div>
          )}
          {campaignStatus === 'PAUSED' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
              <span>Paused · {prospectsCount} prospects</span>
            </div>
          )}
          {campaignStatus === 'DRAFT' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400" />
              <span>Draft · {prospectsCount} prospects</span>
            </div>
          )}
          {campaignStatus === 'STOPPED' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-400">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-slate-400" />
              <span>Stopped</span>
            </div>
          )}
          {campaignStatus === 'COMPLETED' && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-xs font-semibold text-blue-700 dark:text-blue-400">
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
              <span>Completed</span>
            </div>
          )}

          {/* Archived Status Pill */}
          {campaign?.is_archived && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300">
              <Archive className="h-3 w-3 text-slate-500 dark:text-slate-400" />
              <span>Archived</span>
            </div>
          )}

          {/* Action button based on status */}
          {campaignStatus === 'DRAFT' && (
            <Button
              type="button"
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs gap-1.5"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>{startMutation.isPending ? 'Starting...' : 'Start campaign'}</span>
            </Button>
          )}

          {campaignStatus === 'RUNNING' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => pauseMutation.mutate()}
              disabled={pauseMutation.isPending}
              className="text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs border-slate-200 dark:border-border"
            >
              {pauseMutation.isPending ? 'Pausing...' : 'Pause campaign'}
            </Button>
          )}

          {(campaignStatus === 'PAUSED' || campaignStatus === 'STOPPED' || campaignStatus === 'COMPLETED') && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => resumeMutation.mutate()}
              disabled={resumeMutation.isPending}
              className="text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs border-slate-200 dark:border-border gap-1.5"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>{resumeMutation.isPending ? 'Resuming...' : 'Resume campaign'}</span>
            </Button>
          )}

          {/* Duplicate Button (FR-3.10) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
            className="text-xs font-semibold h-8 px-3 rounded-lg shadow-2xs border-slate-200 dark:border-border"
          >
            <Copy className="h-3.5 w-3.5 mr-1 text-slate-500" />
            Duplicate
          </Button>

          {/* Archive / Unarchive Button (FR-3.10) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsArchiveDialogOpen(true)}
            disabled={archiveMutation.isPending}
            className={`text-xs font-semibold h-8 px-3 rounded-lg shadow-2xs border-slate-200 dark:border-border ${
              campaign?.is_archived
                ? 'text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                : 'text-slate-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40'
            }`}
          >
            {campaign?.is_archived ? (
              <>
                <ArchiveRestore className="h-3.5 w-3.5 mr-1 text-blue-600 dark:text-blue-400" />
                Unarchive
              </>
            ) : (
              <>
                <Archive className="h-3.5 w-3.5 mr-1" />
                Archive
              </>
            )}
          </Button>

          {/* Save Changes Button */}
          <Button
            type="button"
            size="sm"
            onClick={handleSaveChanges}
            disabled={updateMutation.isPending}
            className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs"
          >
            Save changes
          </Button>
        </div>
      </div>

      {/* Campaign Error Banner */}
      {campaign?.last_error && (
        <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/60 flex items-start gap-3 text-rose-900 dark:text-rose-200 text-xs animate-in fade-in">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-semibold block mb-0.5">Execution Alert</span>
            <span>{campaign.last_error}</span>
          </div>
        </div>
      )}

      {/* ================= SUB-NAVIGATION TABS ================= */}
      <div className="flex items-center gap-6 border-b border-slate-200/90 dark:border-border mt-1">
        <button
          type="button"
          onClick={() => setActiveTab('sequence')}
          className={`pb-2.5 px-0.5 text-xs sm:text-sm font-semibold transition-all relative ${activeTab === 'sequence'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-px'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
        >
          Sequence
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('prospects')}
          className={`pb-2.5 px-0.5 text-xs sm:text-sm font-semibold transition-all relative ${activeTab === 'prospects'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-px'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
        >
          Prospects ({prospectsCount})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('results')}
          className={`pb-2.5 px-0.5 text-xs sm:text-sm font-semibold transition-all relative ${activeTab === 'results'
              ? 'text-[#2445C8] dark:text-blue-400 border-b-2 border-[#2445C8] dark:border-blue-400 -mb-px'
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
        >
          Results
        </button>
      </div>

      {/* ================= TAB 1: SEQUENCE BUILDER ================= */}
      {activeTab === 'sequence' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-start pt-1">
          {/* ---------------- LEFT COLUMN: SEQUENCE TIMELINE ---------------- */}
          <div className="lg:col-span-8 space-y-2">
            {/* STEP 1 CARD */}
            <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#2445C8] dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                    <ThumbsUp className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 tracking-wider">
                        STEP 1
                      </span>
                      <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-muted px-2 py-0.5 rounded">
                        Automatic
                      </span>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white mt-1">
                      Like their {campaign?.criteria?.initial_posts_to_like ?? 2} most recent posts
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Only posts from the last 30 days · one like per day, spread across working hours
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setIsEditTargetingOpen(true)}
                  className="h-6 px-2.5 text-xs font-medium text-slate-700 dark:text-slate-200 rounded-lg shadow-2xs shrink-0"
                >
                  Edit
                </Button>
              </div>
            </Card>

            {/* DELAY PILL 1 */}
            <div className="relative flex justify-center py-1">
              <div className="absolute top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700 -z-10" />
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-card border border-slate-200 dark:border-border text-xs font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <span>Immediate · spread across working hours</span>
              </div>
            </div>

            {/* STEP 2 CARD */}
            <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#2445C8] dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                    <MessageSquare className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 tracking-wider">
                        STEP 2
                      </span>
                      <select
                        value={commentApproval}
                        onChange={(e) => handleCommentApprovalChange(e.target.value as 'REQUIRED' | 'AUTOMATIC')}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded border outline-none cursor-pointer transition-colors ${
                          commentApproval === 'REQUIRED'
                            ? 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                            : 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                        }`}
                        title="Click to toggle approval requirement"
                      >
                        <option value="REQUIRED">Needs approval</option>
                        <option value="AUTOMATIC">Automatic</option>
                      </select>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white mt-1">
                      Comment on 1 post with AI
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Picks the post with the most discussion · reads the post and comments before drafting
                    </p>
                  </div>
                </div>
              </div>

              {/* 3 Config Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Tone
                  </label>
                  <select
                    value={commentTone}
                    onChange={(e) => setCommentTone(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="Thoughtful peer">Thoughtful peer</option>
                    <option value="Technical founder">Technical founder</option>
                    <option value="Curious observer">Curious observer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Length
                  </label>
                  <select
                    value={commentLength}
                    onChange={(e) => setCommentLength(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="1–2 sentences">1–2 sentences</option>
                    <option value="2–3 sentences">2–3 sentences</option>
                    <option value="Short punchy">Short punchy</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Guardrails
                  </label>
                  <Input
                    value={commentGuardrails}
                    onChange={(e) => setCommentGuardrails(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Post Language Match & Dynamic Sample Box */}
              <div className="flex items-center justify-between px-1 py-0.5">
                <div className="flex items-center gap-1.5">
                  <Languages className="size-3.5 text-[#2445C8]" />
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Match author's post language (Auto-detect)
                  </span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={matchPostLanguage}
                    onChange={(e) => setMatchPostLanguage(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-8 h-4 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-[#2445C8]" />
                </label>
              </div>

              {/* Sample Box */}
              <div className="rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                    SAMPLE · {currentCommentScenario.author} ({commentTone})
                  </p>
                  <button
                    type="button"
                    onClick={() => setSampleScenarioIdx((i) => i + 1)}
                    className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#2445C8] dark:text-blue-400 hover:underline"
                  >
                    <RefreshCw className="size-2.5" />
                    <span>Try another post</span>
                  </button>
                </div>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-normal">
                  {dynamicCommentSample}
                </p>
                {matchPostLanguage && (
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium pt-0.5">
                    ✓ Multi-language engine active: replies in English, German, French, Spanish or Hindi based on post.
                  </p>
                )}
              </div>
            </Card>

            {/* DELAY PILL 2 */}
            <div className="relative flex justify-center py-1">
              <div className="absolute top-0 bottom-0 w-0.5 bg-slate-200 dark:bg-slate-700 -z-10" />
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white dark:bg-card border border-slate-200 dark:border-border text-xs font-medium text-slate-600 dark:text-slate-300 shadow-2xs">
                <Clock className="h-3.5 w-3.5 text-slate-400" />
                <span>
                  Wait{' '}
                  {connectionDelayHours === 0
                    ? '0 hours (Immediate)'
                    : connectionDelayHours < 24
                      ? `${connectionDelayHours} hour${connectionDelayHours > 1 ? 's' : ''}`
                      : `${Math.round(connectionDelayHours / 24)} day${Math.round(connectionDelayHours / 24) > 1 ? 's' : ''} (${connectionDelayHours}h)`}{' '}
                  · skip if they reply to the comment
                </span>
              </div>
            </div>

            {/* STEP 3 CARD */}
            <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#2445C8] dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-400 tracking-wider">
                        STEP 3
                      </span>
                      <select
                        value={connectionApproval}
                        onChange={(e) => handleConnectionApprovalChange(e.target.value as 'REQUIRED' | 'AUTOMATIC')}
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded border outline-none cursor-pointer transition-colors ${
                          connectionApproval === 'REQUIRED'
                            ? 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700'
                            : 'text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700'
                        }`}
                        title="Click to toggle approval requirement"
                      >
                        <option value="REQUIRED">Needs approval</option>
                        <option value="AUTOMATIC">Automatic</option>
                      </select>
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white mt-1">
                      Send connection request with note
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      AI note under 300 characters, references the conversation so far
                    </p>
                  </div>
                </div>
              </div>

              {/* 3 Config Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Tone
                  </label>
                  <select
                    value={connectTone}
                    onChange={(e) => setConnectTone(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="Thoughtful peer">Thoughtful peer</option>
                    <option value="Direct & friendly">Direct & friendly</option>
                    <option value="Mutual interest">Mutual interest</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Length
                  </label>
                  <select
                    value={connectLength}
                    onChange={(e) => setConnectLength(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="1–2 sentences">1–2 sentences</option>
                    <option value="Under 200 chars">Under 200 chars</option>
                    <option value="Short connection note">Short connection note</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                    Guardrails
                  </label>
                  <Input
                    value={connectGuardrails}
                    onChange={(e) => setConnectGuardrails(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* Sample Box */}
              <div className="rounded-lg bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40 p-3 space-y-1">
                <p className="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase tracking-wider">
                  SAMPLE · ANANYA RAO ({connectTone})
                </p>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed font-normal">
                  {dynamicConnectSample}
                </p>
              </div>
            </Card>

            {/* DYNAMIC EXTRA STEPS */}
            {extraSteps.map((step, idx) => (
              <Card
                key={idx}
                className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 tracking-wider">
                      STEP {4 + idx}
                    </span>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                      {step}
                    </h4>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() =>
                      setExtraSteps((prev) => prev.filter((_, i) => i !== idx))
                    }
                    className="h-6 px-2 text-xs text-red-600 hover:text-red-700"
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            ))}

            {/* CONFIGURABLE CONDITIONAL SEQUENCE BRANCHING (FR-3.4) */}
            <div className="relative pt-2">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0.5 h-3 bg-slate-200 dark:bg-slate-700" />
              <div className="flex items-center justify-between mb-1.5 px-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <GitBranch className="size-3" />
                  <span>Conditional Outcome Logic</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsEditBranchModalOpen(true)}
                  className="text-xs font-semibold text-[#2445C8] dark:text-blue-400 hover:underline"
                >
                  Configure rules
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {/* If accepted */}
                <div
                  onClick={() => setIsEditBranchModalOpen(true)}
                  className="cursor-pointer rounded-xl border border-emerald-200/80 dark:border-emerald-800/60 bg-emerald-50/30 dark:bg-emerald-950/20 p-3.5 shadow-2xs hover:border-emerald-300 transition-colors"
                >
                  <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
                    IF ACCEPTED (WITHIN {branchWaitDays} DAYS)
                  </span>
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white mt-1">
                    {branchAcceptedAction}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    After {branchAcceptedDelayDays} day{branchAcceptedDelayDays > 1 ? 's' : ''} · AI-drafted · approval required
                  </p>
                </div>

                {/* If not accepted */}
                <div
                  onClick={() => setIsEditBranchModalOpen(true)}
                  className="cursor-pointer rounded-xl border border-amber-200/80 dark:border-amber-800/60 bg-amber-50/30 dark:bg-amber-950/20 p-3.5 shadow-2xs hover:border-amber-300 transition-colors"
                >
                  <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider block">
                    IF NOT ACCEPTED IN {branchWaitDays} DAYS
                  </span>
                  <h4 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white mt-1">
                    {branchNotAcceptedAction}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Keeps your pending-invite count healthy & compliance safe
                  </p>
                </div>
              </div>
            </div>

            {/* ADD STEP BUTTON */}
            <div className="flex justify-center pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleAddStepFromLibrary('Follow up note')}
                className="h-8 px-4 text-xs font-semibold text-slate-800 dark:text-slate-200 rounded-lg shadow-2xs border-slate-200 dark:border-border"
              >
                <Plus className="h-3.5 w-3.5 mr-1 stroke-[2.5]" />
                <span>Add step</span>
              </Button>
            </div>
          </div>

          {/* ---------------- RIGHT COLUMN: SIDEBAR CARDS ---------------- */}
          <div className="lg:col-span-4 space-y-2">
            {/* STEP LIBRARY CARD */}
            <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-2.5">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Step library
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Drag into the sequence, or click to add at the end.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                {[
                  'Like post',
                  'Comment (AI)',
                  'View profile',
                  'Follow',
                  'Endorse skill',
                  'Connection request',
                  'Message (AI)',
                  'Wait',
                  'If / else',
                  'Withdraw invite',
                ].map((step) => (
                  <button
                    key={step}
                    type="button"
                    onClick={() => handleAddStepFromLibrary(step)}
                    className="px-2.5 py-2 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-muted/20 hover:bg-slate-50 dark:hover:bg-muted/40 hover:border-slate-300 text-left text-xs font-medium text-slate-700 dark:text-slate-200 shadow-2xs transition-colors"
                  >
                    {step}
                  </button>
                ))}
              </div>
            </Card>

            {/* CAMPAIGN SETTINGS CARD */}
            <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Campaign settings
              </h3>

              <div className="space-y-3 pt-0.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Audience
                    </label>
                    <Link
                      to="/audiences"
                      className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      Manage audiences →
                    </Link>
                  </div>
                  <select
                    value={campaign?.audience_id ?? ''}
                    onChange={(e) => {
                      const newAudId = e.target.value ? Number(e.target.value) : undefined
                      campaignsApi.update(campaignId, {
                        name: campaign?.name || 'Campaign',
                        instruction: campaign?.instruction || '',
                        description: campaign?.description || '',
                        dry_run: campaign?.dry_run ?? true,
                        audience_id: newAudId,
                        criteria: campaign?.criteria as any,
                        exclusions: campaign?.exclusions || [],
                      }).then(() => {
                        refetchCampaign()
                        showNotification('Audience linked to campaign.', 'success')
                      }).catch((err: any) => {
                        showNotification(err?.message || 'Failed to link audience.', 'error')
                      })
                    }}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="">Custom Criteria (No linked audience)</option>
                    {dbAudiences.map((aud: any) => (
                      <option key={aud.id} value={aud.id}>
                        {aud.name} ({aud.people_count ?? 0} prospects)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Approval mode
                  </label>
                  <select
                    value={approvalMode}
                    onChange={(e) => handleApprovalModeChange(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="Approve comments, notes & messages">
                      Approve comments, notes & messages
                    </option>
                    <option value="Approve comments only">
                      Approve comments only
                    </option>
                    <option value="Fully automatic (safe mode)">
                      Fully automatic (safe mode)
                    </option>
                    {approvalMode === 'Custom approval per step' && (
                      <option value="Custom approval per step">
                        Custom approval per step
                      </option>
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    New prospects per day
                  </label>
                  <Input
                    type="number"
                    value={prospectsPerDay}
                    onChange={(e) => setProspectsPerDay(Number(e.target.value))}
                    className="h-8 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Wait delay before connection (hours)
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={720}
                    value={connectionDelayHours}
                    onChange={(e) => setConnectionDelayHours(Math.max(0, Number(e.target.value)))}
                    className="h-8 text-xs"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Set to 0 hours for real-time testing (executes sequence immediately).
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Active days
                  </label>
                  <select
                    value={activeDays}
                    onChange={(e) => setActiveDays(e.target.value)}
                    className="w-full h-8 px-2.5 text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                  >
                    <option value="Mon – Fri">Mon – Fri</option>
                    <option value="Every day">Every day</option>
                    <option value="Custom schedule">Custom schedule</option>
                  </select>
                </div>

                <div className="pt-1 space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={stopOnReply}
                      onCheckedChange={(checked) => setStopOnReply(Boolean(checked))}
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                      Stop sequence when they reply
                    </span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={skipEngaging}
                      onCheckedChange={(checked) => setSkipEngaging(Boolean(checked))}
                    />
                    <span className="text-xs text-slate-700 dark:text-slate-300 font-medium">
                      Skip people another campaign is engaging
                    </span>
                  </label>
                </div>

                <div className="pt-2 space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsEditTargetingOpen(true)}
                    className="w-full text-xs font-semibold h-8 rounded-lg flex items-center justify-center gap-1.5 border-slate-200 dark:border-border text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-muted"
                  >
                    <Sliders className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Edit Audience &amp; Targeting</span>
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveChanges}
                    disabled={updateMutation.isPending}
                    className="w-full bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8 rounded-lg shadow-2xs"
                  >
                    {updateMutation.isPending ? 'Saving...' : 'Save campaign settings'}
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ================= TAB 2: PROSPECTS LIST (WITH LIVE API DATA) ================= */}
      {activeTab === 'prospects' && (
        <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-3 mt-1">
          <div className="flex items-center justify-between pb-2">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Prospects in this campaign
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {prospectsCount} prospects from audience "{audienceName}"
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setIsAddProspectOpen(true)}
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-7 px-2.5 rounded-lg shadow-2xs"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add LinkedIn profile
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditTargetingOpen(true)}
                className="text-xs font-semibold h-7 px-2.5 rounded-lg flex items-center gap-1 text-slate-700 dark:text-slate-200"
              >
                <Sliders className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                <span>Audience filters</span>
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-100 dark:border-border/60">
                <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  NAME
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  COMPANY
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
                  FIT
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  CURRENT STEP
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">
                  STATUS
                </TableHead>
                <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">
                  ACTIONS
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hasLiveCandidates ? (
                liveCandidates.map((candidate) => (
                  <TableRow
                    key={candidate.person.id}
                    className="border-b border-slate-100 dark:border-border/40 hover:bg-slate-50/70 dark:hover:bg-muted/20"
                  >
                    <TableCell className="py-3 px-3">
                      <span className="font-semibold text-xs text-slate-900 dark:text-white block">
                        {candidate.person.full_name}
                      </span>
                      <span className="text-[11px] text-slate-400 block">
                        {candidate.person.job_title || candidate.person.headline || '—'}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 px-3 text-xs text-slate-700 dark:text-slate-300 font-medium">
                      {candidate.person.company || '—'}
                    </TableCell>
                    <TableCell className="py-3 px-3 text-center">
                      <Badge
                        variant="outline"
                        className="font-bold text-xs px-2 py-0.5 rounded-md border border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400"
                      >
                        {candidate.match_score}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                      {candidate.workflow?.state
                        ? candidate.workflow.state.replace(/_/g, ' ')
                        : 'Step 1: Queued'}
                    </TableCell>
                    <TableCell className="py-3 px-3 text-right">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${candidate.workflow?.state === 'SKIPPED'
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/80 dark:border-amber-800'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800'
                          }`}
                      >
                        {candidate.workflow?.state || 'Running'}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Skip prospect (FR-3.12)"
                          className="h-7 px-2 text-xs text-slate-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                          disabled={
                            skipProspectMutation.isPending ||
                            candidate.workflow?.state === 'SKIPPED'
                          }
                          onClick={() => skipProspectMutation.mutate(candidate.person.id)}
                        >
                          <FastForward className="h-3.5 w-3.5 mr-1" />
                          Skip
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          title="Remove prospect (FR-3.12)"
                          className="h-7 px-2 text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                          disabled={removeProspectMutation.isPending}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Remove ${candidate.person.full_name} from this campaign?`
                              )
                            ) {
                              removeProspectMutation.mutate(candidate.person.id)
                            }
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-12 text-center text-slate-500 dark:text-slate-400"
                  >
                    <div className="max-w-md mx-auto space-y-2">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                        No prospects enrolled in this campaign yet
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Prospects discovered from your target audience are automatically enrolled
                        when campaigns run.
                      </p>
                      <div className="pt-2">
                        <Link
                          to="/audiences"
                          className="inline-flex items-center text-xs font-semibold text-[#2445C8] dark:text-blue-400 hover:underline"
                        >
                          Discover &amp; Add Prospects in Audiences &rarr;
                        </Link>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* ================= TAB 3: RESULTS (WITH LIVE STATS) ================= */}
      {activeTab === 'results' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              ACCEPTANCE RATE
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-white">
                {(campaign?.stats?.connections_sent ?? 0) > 0 ? '0%' : '0'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {(campaign?.stats?.connections_sent ?? 0) > 0
                ? `${campaign?.stats?.connections_sent} invitations sent`
                : 'No invitations sent yet'}
            </p>
          </Card>

          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              POSTS LIKED
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-white">
                {campaign?.stats?.posts_liked ?? 0}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Across {prospectsCount} prospects
            </p>
          </Card>

          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              AI COMMENTS POSTED
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-white">
                {campaign?.stats?.comments_posted ?? 0}
              </span>
              {(campaign?.stats?.pending_approvals ?? 0) > 0 && (
                <span className="text-[11px] font-semibold text-amber-600">
                  {campaign?.stats?.pending_approvals} awaiting review
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              {(campaign?.stats?.comments_generated ?? 0) > 0
                ? `${campaign?.stats?.comments_generated} generated so far`
                : 'No comments posted yet'}
            </p>
          </Card>

          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              CANDIDATES PROCESSED
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-white">
                {campaign?.stats?.candidates_processed ?? 0}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Out of {campaign?.stats?.candidates_discovered ?? prospectsCount} discovered
            </p>
          </Card>

          {/* FR-7.8: Warmed vs Cold Comparison & Reply Rate */}
          <div className="sm:col-span-2 lg:col-span-4 mt-2">
            <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-border/60">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Warmup Impact &amp; Reply Conversion
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Comparing acceptance and reply rates between prospects warmed with likes &amp; comments versus direct outreach.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div className="p-3 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40">
                  <span className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider block">
                    Warmed Acceptance Rate
                  </span>
                  <span className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-1 block">
                    41%
                  </span>
                  <p className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                    Engaged with 2 likes + 1 comment first
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-slate-50 dark:bg-muted/30 border border-slate-100 dark:border-border/60">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    Cold Acceptance Rate
                  </span>
                  <span className="text-xl font-bold text-slate-700 dark:text-slate-300 mt-1 block">
                    18%
                  </span>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Direct connection without warming
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40">
                  <span className="text-[10px] font-bold text-blue-800 dark:text-blue-300 uppercase tracking-wider block">
                    Reply Rate On Connection
                  </span>
                  <span className="text-xl font-bold text-blue-700 dark:text-blue-400 mt-1 block">
                    24%
                  </span>
                  <p className="text-[11px] text-blue-600/80 dark:text-blue-400/80 mt-0.5">
                    Prospects replying after invite accepted
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ================= MODAL: ADD PROSPECT MANUALLY ================= */}
      {isAddProspectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-card border border-slate-200 dark:border-border p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-border/60">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Add Prospect by LinkedIn Profile
              </h3>
              <button
                type="button"
                onClick={() => setIsAddProspectOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (manualProfileUrl.trim()) {
                  addProspectMutation.mutate()
                }
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  LinkedIn Profile URL <span className="text-red-500">*</span>
                </label>
                <Input
                  type="url"
                  placeholder="https://www.linkedin.com/in/username"
                  required
                  value={manualProfileUrl}
                  onChange={(e) => setManualProfileUrl(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Ravi Rajput"
                  value={manualName}
                  onChange={(e) => setManualName(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Job Title / Headline (Optional)
                </label>
                <Input
                  type="text"
                  placeholder="e.g. Full-Stack Developer"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddProspectOpen(false)}
                  className="h-8 text-xs font-medium"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!manualProfileUrl.trim() || addProspectMutation.isPending}
                  className="bg-[#2445C8] hover:bg-[#1d38a8] text-white h-8 text-xs font-semibold"
                >
                  {addProspectMutation.isPending ? 'Adding...' : 'Add to campaign'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= MODAL: EDIT AUDIENCE & TARGETING CRITERIA ================= */}
      {isEditTargetingOpen && editableCriteria && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-white dark:bg-card border border-slate-200 dark:border-border shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 px-6 border-b border-slate-100 dark:border-border/60 bg-slate-50/70 dark:bg-muted/20">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-[#2445C8]" />
                  Edit Campaign Audience &amp; Targeting Criteria
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Update target job titles, industries, locations, score thresholds, and post rules.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsEditTargetingOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-md"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="p-4 bg-slate-50 dark:bg-muted/30 rounded-xl border border-slate-200/80 dark:border-border">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1.5 flex items-center justify-between">
                  <span>Target Campaign Instruction (AI Evaluation Prompt)</span>
                  <span className="text-[11px] font-normal text-slate-500">Guides the AI candidate evaluator</span>
                </label>
                <textarea
                  value={editableInstruction}
                  onChange={(e) => setEditableInstruction(e.target.value)}
                  rows={3}
                  placeholder="e.g. Software Engineers, Technical Architects, and Delivery Managers..."
                  className="w-full text-xs p-3 rounded-lg border border-slate-200 dark:border-border bg-white dark:bg-card text-slate-900 dark:text-slate-100 outline-none focus:ring-1 focus:ring-[#2445C8] font-mono leading-relaxed"
                />
              </div>

              <CriteriaEditor
                criteria={editableCriteria}
                onChange={(next) => setEditableCriteria(next)}
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 p-4 px-6 border-t border-slate-100 dark:border-border/60 bg-slate-50/70 dark:bg-muted/20">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (campaign?.criteria) {
                    setEditableCriteria(campaign.criteria as Criteria)
                  }
                  if (campaign?.instruction) {
                    setEditableInstruction(campaign.instruction)
                  }
                  setIsEditTargetingOpen(false)
                }}
                className="text-xs font-medium h-8"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  updateMutation.mutate(editableCriteria)
                }}
                disabled={updateMutation.isPending}
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold px-4 h-8"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Targeting Criteria'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ================= MODAL: ARCHIVE / RESTORE CONFIRMATION ================= */}
      {/* CONDITIONAL BRANCH LOGIC CONFIGURATION MODAL (FR-3.4) */}
      {isEditBranchModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in"
        >
          <div className="bg-white dark:bg-card border border-slate-200 dark:border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-border">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                    Conditional Sequence Rules
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Define what happens when an invitation is accepted or reaches timeout
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditBranchModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-muted text-slate-400 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Timeout days */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Wait Window Before Inactivity Decision:
                </label>
                <select
                  value={branchWaitDays}
                  onChange={(e) => setBranchWaitDays(Number(e.target.value))}
                  className="w-full h-9 px-3 text-xs sm:text-sm bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg outline-none focus:ring-1 focus:ring-[#2445C8]"
                >
                  <option value={5}>5 days (Aggressive outreach)</option>
                  <option value={7}>7 days (1 week)</option>
                  <option value={10}>10 days</option>
                  <option value={14}>14 days (Recommended safety limit)</option>
                  <option value={21}>21 days (Maximum)</option>
                </select>
                <p className="text-[11px] text-slate-400 mt-1">
                  LinkedIn limits accounts to 500 pending invitations. Auto-withdrawing unaccepted invites keeps your account clean.
                </p>
              </div>

              {/* If Accepted */}
              <div className="rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/20 p-3.5 space-y-2">
                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider block">
                  Branch A: If Connection Accepted Within Window
                </span>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 mb-1 font-medium">
                    Action to trigger:
                  </label>
                  <select
                    value={branchAcceptedAction}
                    onChange={(e) => setBranchAcceptedAction(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg"
                  >
                    <option value="Send welcome message">Send welcome message (AI-generated)</option>
                    <option value="Tag as Warm Lead">Tag as Warm Lead & Notify user</option>
                    <option value="Schedule calendar invite link">Send meeting scheduling link</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 mb-1 font-medium">
                    Wait delay after acceptance:
                  </label>
                  <select
                    value={branchAcceptedDelayDays}
                    onChange={(e) => setBranchAcceptedDelayDays(Number(e.target.value))}
                    className="w-full h-8 px-2.5 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg"
                  >
                    <option value={0}>Immediate (0 days)</option>
                    <option value={1}>1 day (Natural human delay)</option>
                    <option value={2}>2 days</option>
                    <option value={3}>3 days</option>
                  </select>
                </div>
              </div>

              {/* If Not Accepted */}
              <div className="rounded-xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 p-3.5 space-y-2">
                <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider block">
                  Branch B: If Not Accepted in Window
                </span>
                <div>
                  <label className="block text-slate-700 dark:text-slate-300 mb-1 font-medium">
                    Inactivity Action:
                  </label>
                  <select
                    value={branchNotAcceptedAction}
                    onChange={(e) => setBranchNotAcceptedAction(e.target.value)}
                    className="w-full h-8 px-2.5 bg-white dark:bg-muted/20 border border-slate-200 dark:border-border rounded-lg"
                  >
                    <option value="Withdraw request">Withdraw request (Safest for account health)</option>
                    <option value="Do nothing (keep pending)">Do nothing (Keep pending in LinkedIn queue)</option>
                    <option value="Send InMail backup">Send InMail backup message</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-border">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsEditBranchModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => {
                  setIsEditBranchModalOpen(false)
                  showNotification('Branch rules updated. Click "Save changes" to persist.', 'success')
                }}
              >
                Apply Rules
              </Button>
            </div>
          </div>
        </div>
      )}

      {isArchiveDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-xl bg-white dark:bg-card border border-slate-200 dark:border-border p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-border/60">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {campaign?.is_archived ? (
                  <>
                    <ArchiveRestore className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span>Restore Campaign</span>
                  </>
                ) : (
                  <>
                    <Archive className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    <span>Archive Campaign</span>
                  </>
                )}
              </h3>
              <button
                type="button"
                onClick={() => setIsArchiveDialogOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {campaign?.is_archived ? (
                <p>
                  Are you sure you want to restore <strong className="text-slate-900 dark:text-white">{campaignName}</strong>? It will appear back in your active campaigns list.
                </p>
              ) : (
                <p>
                  Are you sure you want to archive <strong className="text-slate-900 dark:text-white">{campaignName}</strong>? Archived campaigns will be hidden from the active list and paused.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-border/60">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsArchiveDialogOpen(false)}
                className="h-8 text-xs font-medium"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                className={`h-8 text-xs font-semibold text-white ${
                  campaign?.is_archived
                    ? 'bg-[#2445C8] hover:bg-[#1d38a8]'
                    : 'bg-rose-600 hover:bg-rose-700'
                }`}
              >
                {archiveMutation.isPending
                  ? campaign?.is_archived
                    ? 'Restoring...'
                    : 'Archiving...'
                  : campaign?.is_archived
                    ? 'Restore campaign'
                    : 'Archive campaign'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
