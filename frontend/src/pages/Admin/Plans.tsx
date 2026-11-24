import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Plus,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react'
import { useState, useMemo } from 'react'

import {
  Badge,
  Button,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Stat,
  Textarea,
} from '@/components/ui'
import { adminApi } from '@/services/api'
import { ApiRequestError } from '@/services/client'
import type { PlanAdmin, PlanCreatePayload, PlanUpdatePayload } from '@/types/api'

function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}

interface PlanFormData {
  id: string
  name: string
  description: string
  badge: string
  monthly_price: number
  annual_price: number
  currency: string
  trial_days: number
  is_recommended: boolean
  is_active: boolean
  sort_order: number
  button_label: string
  max_campaigns: number
  monthly_ai_prospects: number
  daily_action_limit: number
  has_smart_pacing: boolean
  has_2fa_proxy: boolean
  has_custom_ai_prompts: boolean
  features: string[]
}

const DEFAULT_FORM_DATA: PlanFormData = {
  id: '',
  name: '',
  description: '',
  badge: '',
  monthly_price: 29,
  annual_price: 24,
  currency: 'USD',
  trial_days: 14,
  is_recommended: false,
  is_active: true,
  sort_order: 0,
  button_label: 'Start Free Trial',
  max_campaigns: 5,
  monthly_ai_prospects: 1000,
  daily_action_limit: 50,
  has_smart_pacing: true,
  has_2fa_proxy: true,
  has_custom_ai_prompts: false,
  features: ['5 Active Campaigns', '1,000 AI prospects / month', 'Smart human-like pacing'],
}

export function AdminPlans() {
  const queryClient = useQueryClient()
  const [modalOpen, setModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<PlanAdmin | null>(null)
  const [formData, setFormData] = useState<PlanFormData>(DEFAULT_FORM_DATA)
  const [newFeatureText, setNewFeatureText] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const {
    data: plans,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'plans'],
    queryFn: adminApi.plans.list,
  })

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'plans'] })
    void queryClient.invalidateQueries({ queryKey: ['plans'] })
  }

  const createMutation = useMutation({
    mutationFn: (payload: PlanCreatePayload) => adminApi.plans.create(payload),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err) => setActionError(errorMessage(err)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PlanUpdatePayload }) =>
      adminApi.plans.update(id, payload),
    onSuccess: () => {
      invalidate()
      closeModal()
    },
    onError: (err) => setActionError(errorMessage(err)),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: (id: string) => adminApi.plans.toggleActive(id),
    onSuccess: () => invalidate(),
    onError: (err) => setActionError(errorMessage(err)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.plans.delete(id),
    onSuccess: () => {
      invalidate()
      setDeleteConfirmId(null)
    },
    onError: (err) => setActionError(errorMessage(err)),
  })

  const reorderMutation = useMutation({
    mutationFn: (newOrderIds: string[]) => adminApi.plans.reorder(newOrderIds),
    onSuccess: () => invalidate(),
    onError: (err) => setActionError(errorMessage(err)),
  })

  function handleMove(currentIndex: number, direction: 'left' | 'right') {
    if (!plans) return
    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1
    if (targetIndex < 0 || targetIndex >= plans.length) return

    const newOrder = [...plans]
    const [moved] = newOrder.splice(currentIndex, 1)
    newOrder.splice(targetIndex, 0, moved)

    reorderMutation.mutate(newOrder.map((p) => p.id))
  }

  const positionOptions = useMemo(() => {
    const count = Math.max(plans?.length || 3, 3)
    const options = []
    const totalSlots = editingPlan ? count : count + 1
    for (let i = 1; i <= totalSlots; i++) {
      const suffix = i === 1 ? 'st' : i === 2 ? 'nd' : i === 3 ? 'rd' : 'th'
      const existingPlan = plans?.find((p) => p.sort_order === i && p.id !== editingPlan?.id)
      const label = existingPlan
        ? `Position ${i} (${i}${suffix}) — before "${existingPlan.name}"`
        : `Position ${i} (${i}${suffix})`
      options.push({ value: i, label })
    }
    if (formData.sort_order && !options.some((o) => o.value === formData.sort_order)) {
      options.push({ value: formData.sort_order, label: `Position ${formData.sort_order}` })
      options.sort((a, b) => a.value - b.value)
    }
    return options
  }, [plans, editingPlan, formData.sort_order])

  function openCreateModal() {
    setEditingPlan(null)
    setFormData({
      ...DEFAULT_FORM_DATA,
      sort_order: plans ? plans.length + 1 : 1,
    })
    setActionError(null)
    setModalOpen(true)
  }

  function openEditModal(plan: PlanAdmin) {
    setEditingPlan(plan)
    setFormData({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      badge: plan.badge || '',
      monthly_price: Number(plan.monthly_price),
      annual_price: Number(plan.annual_price),
      currency: plan.currency,
      trial_days: plan.trial_days,
      is_recommended: plan.is_recommended,
      is_active: plan.is_active,
      sort_order: plan.sort_order,
      button_label: plan.button_label,
      max_campaigns: plan.max_campaigns,
      monthly_ai_prospects: plan.monthly_ai_prospects,
      daily_action_limit: plan.daily_action_limit,
      has_smart_pacing: plan.has_smart_pacing,
      has_2fa_proxy: plan.has_2fa_proxy,
      has_custom_ai_prompts: plan.has_custom_ai_prompts,
      features: [...(plan.features || [])],
    })
    setActionError(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingPlan(null)
    setActionError(null)
    setNewFeatureText('')
  }

  function handleAddFeature() {
    const text = newFeatureText.trim()
    if (!text) return
    if (!formData.features.includes(text)) {
      setFormData((prev) => ({ ...prev, features: [...prev.features, text] }))
    }
    setNewFeatureText('')
  }

  function handleRemoveFeature(index: number) {
    setFormData((prev) => ({
      ...prev,
      features: prev.features.filter((_, i) => i !== index),
    }))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActionError(null)

    if (editingPlan) {
      if (plans && formData.sort_order !== editingPlan.sort_order) {
        const remaining = plans.filter((p) => p.id !== editingPlan.id)
        const targetIdx = Math.max(0, Math.min(formData.sort_order - 1, remaining.length))
        remaining.splice(targetIdx, 0, { ...editingPlan, sort_order: formData.sort_order })
        reorderMutation.mutate(remaining.map((p) => p.id))
      }

      const payload: PlanUpdatePayload = {
        name: formData.name,
        description: formData.description,
        badge: formData.badge.trim() || null,
        monthly_price: Number(formData.monthly_price),
        annual_price: Number(formData.annual_price),
        currency: formData.currency,
        trial_days: Number(formData.trial_days),
        is_recommended: formData.is_recommended,
        is_active: formData.is_active,
        sort_order: Number(formData.sort_order),
        button_label: formData.button_label,
        max_campaigns: Number(formData.max_campaigns),
        monthly_ai_prospects: Number(formData.monthly_ai_prospects),
        daily_action_limit: Number(formData.daily_action_limit),
        has_smart_pacing: formData.has_smart_pacing,
        has_2fa_proxy: formData.has_2fa_proxy,
        has_custom_ai_prompts: formData.has_custom_ai_prompts,
        features: formData.features,
      }
      updateMutation.mutate({ id: editingPlan.id, payload })
    } else {
      if (!formData.id.trim()) {
        setActionError('Plan Identifier is required.')
        return
      }
      const payload: PlanCreatePayload = {
        id: formData.id.trim().toLowerCase(),
        name: formData.name,
        description: formData.description,
        badge: formData.badge.trim() || null,
        monthly_price: Number(formData.monthly_price),
        annual_price: Number(formData.annual_price),
        currency: formData.currency,
        trial_days: Number(formData.trial_days),
        is_recommended: formData.is_recommended,
        is_active: formData.is_active,
        sort_order: Number(formData.sort_order),
        button_label: formData.button_label,
        max_campaigns: Number(formData.max_campaigns),
        monthly_ai_prospects: Number(formData.monthly_ai_prospects),
        daily_action_limit: Number(formData.daily_action_limit),
        has_smart_pacing: formData.has_smart_pacing,
        has_2fa_proxy: formData.has_2fa_proxy,
        has_custom_ai_prompts: formData.has_custom_ai_prompts,
        features: formData.features,
      }
      createMutation.mutate(payload)
    }
  }

  // Calculate high-level stats
  const totalPlans = plans?.length ?? 0
  const activePlans = plans?.filter((p) => p.is_active).length ?? 0
  const totalSubscribers = plans?.reduce((acc, p) => acc + (p.subscriber_count || 0), 0) ?? 0
  const recommendedPlan = plans?.find((p) => p.is_recommended)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscription Plans"
        description="Configure dynamic pricing tiers, operational quotas, and feature flags. Changes sync instantly to new user onboarding."
        action={
          <Button variant="primary" onClick={openCreateModal} className="gap-2">
            <Plus className="size-4" />
            <span>Create Plan</span>
          </Button>
        }
      />

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical">
          <AlertCircle className="size-4 shrink-0" />
          <span>{actionError}</span>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-auto text-critical hover:opacity-80"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* KPI Stats Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Plans" value={totalPlans} hint="Across all tiers" />
        <Stat
          label="Published Plans"
          value={activePlans}
          hint={`${totalPlans - activePlans} in draft/archived`}
        />
        <Stat
          label="Active Subscribers"
          value={totalSubscribers}
          hint="Assigned registered accounts"
        />
        <Stat
          label="Featured Tier"
          value={recommendedPlan ? recommendedPlan.name : 'None'}
          hint={recommendedPlan ? `Badge: ${recommendedPlan.badge || 'Recommended'}` : 'No plan selected'}
        />
      </div>

      {isLoading && <LoadingState label="Loading plans..." />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {/* Plans Grid */}
      {!isLoading && !error && plans && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">Tier Catalog & Quotas</h2>
            <span className="text-xs text-ink-muted">
              Live updates propagate to the user registration plan picker
            </span>
          </div>

          {plans.length === 0 ? (
            <EmptyState
              title="No plans found"
              description="Create your first subscription plan to allow users to register and select a plan."
              action={
                <Button variant="primary" onClick={openCreateModal}>
                  Create Plan
                </Button>
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {plans.map((plan, index) => {
                const isDeleting = deleteMutation.isPending && deleteConfirmId === plan.id
                return (
                  <div
                    key={plan.id}
                    className={`relative flex flex-col justify-between rounded-xl border bg-surface p-5 shadow-sm transition-all hover:shadow-md ${
                      plan.is_recommended
                        ? 'border-accent ring-1 ring-accent/30'
                        : 'border-border-subtle'
                    } ${!plan.is_active ? 'opacity-70 bg-surface-muted/30' : ''}`}
                  >
                    {/* Header Badges */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Badge tone={plan.is_active ? 'positive' : 'neutral'}>
                          {plan.is_active ? 'Published' : 'Draft / Inactive'}
                        </Badge>
                        {plan.is_recommended && (
                          <Badge tone="accent" className="flex items-center gap-1">
                            <Sparkles className="size-3" />
                            {plan.badge || 'Popular'}
                          </Badge>
                        )}
                        {!plan.is_recommended && plan.badge && (
                          <Badge tone="neutral">{plan.badge}</Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Users className="size-3.5 text-ink-faint" />
                        <span className="font-medium text-ink">{plan.subscriber_count}</span>{' '}
                        <span>users</span>
                      </div>
                    </div>

                    {/* Plan Details */}
                    <div className="mt-4">
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-lg font-bold text-ink">{plan.name}</h3>
                        <span className="font-mono text-xs text-ink-faint">id: {plan.id}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-ink-muted">
                        {plan.description}
                      </p>

                      {/* Pricing */}
                      <div className="mt-4 rounded-lg bg-surface-muted/60 p-3">
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-black text-ink">
                            ${Number(plan.monthly_price).toFixed(0)}
                          </span>
                          <span className="text-xs text-ink-muted">/month</span>
                          <span className="mx-2 text-border-subtle">|</span>
                          <span className="text-sm font-semibold text-accent">
                            ${Number(plan.annual_price).toFixed(0)}
                          </span>
                          <span className="text-xs text-ink-muted">/mo billed yearly</span>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-ink-faint">
                          <span>{plan.trial_days}-day free trial</span>
                          <div className="flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 border border-border-subtle shadow-2xs">
                            <button
                              type="button"
                              disabled={index === 0 || reorderMutation.isPending}
                              title="Move Left (Earlier in display sequence)"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleMove(index, 'left')
                              }}
                              className="p-0.5 text-ink-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <ChevronLeft className="size-3.5" />
                            </button>
                            <span className="font-semibold text-ink px-1 text-[11px]" title={`Sequence #${plan.sort_order}`}>
                              #{plan.sort_order}
                            </span>
                            <button
                              type="button"
                              disabled={index === plans.length - 1 || reorderMutation.isPending}
                              title="Move Right (Later in display sequence)"
                              onClick={(e) => {
                                e.stopPropagation()
                                handleMove(index, 'right')
                              }}
                              className="p-0.5 text-ink-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <ChevronRight className="size-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Quotas & Flags */}
                      <div className="mt-4 space-y-2 border-t border-border-subtle pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                          Operational Limits
                        </p>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded border border-border-subtle bg-surface px-2 py-1.5">
                            <span className="block text-ink-faint">Campaigns</span>
                            <span className="font-semibold text-ink">
                              {plan.max_campaigns} active
                            </span>
                          </div>
                          <div className="rounded border border-border-subtle bg-surface px-2 py-1.5">
                            <span className="block text-ink-faint">AI Prospects</span>
                            <span className="font-semibold text-ink">
                              {plan.monthly_ai_prospects.toLocaleString()}/mo
                            </span>
                          </div>
                          <div className="rounded border border-border-subtle bg-surface px-2 py-1.5">
                            <span className="block text-ink-faint">Daily Actions</span>
                            <span className="font-semibold text-ink">
                              {plan.daily_action_limit}/day
                            </span>
                          </div>
                          <div className="rounded border border-border-subtle bg-surface px-2 py-1.5">
                            <span className="block text-ink-faint">Safety Proxy</span>
                            <span
                              className={`font-semibold ${
                                plan.has_2fa_proxy ? 'text-positive' : 'text-ink-faint'
                              }`}
                            >
                              {plan.has_2fa_proxy ? 'Dedicated 2FA' : 'Standard'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Features List */}
                      <div className="mt-4 border-t border-border-subtle pt-3">
                        <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                          Features ({plan.features?.length || 0})
                        </p>
                        <ul className="mt-2 space-y-1.5 text-xs text-ink-muted">
                          {(plan.features || []).slice(0, 4).map((feat, idx) => (
                            <li key={idx} className="flex items-start gap-1.5">
                              <Check className="mt-0.5 size-3.5 shrink-0 text-positive" />
                              <span className="line-clamp-1">{feat}</span>
                            </li>
                          ))}
                          {(plan.features?.length || 0) > 4 && (
                            <li className="text-xs italic text-ink-faint">
                              +{(plan.features?.length || 0) - 4} more features
                            </li>
                          )}
                        </ul>
                      </div>
                    </div>

                    {/* Bottom Actions */}
                    <div className="mt-6 border-t border-border-subtle pt-4">
                      {deleteConfirmId === plan.id ? (
                        <div className="space-y-2 rounded-lg border border-critical/30 bg-critical-soft p-3 text-xs">
                          <p className="font-medium text-critical">
                            Are you sure you want to delete this plan?
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="danger"
                              loading={isDeleting}
                              onClick={() => deleteMutation.mutate(plan.id)}
                              className="text-xs py-1 px-2.5"
                            >
                              Confirm Delete
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setDeleteConfirmId(null)}
                              className="text-xs py-1 px-2.5"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => toggleActiveMutation.mutate(plan.id)}
                            className="text-xs font-medium text-ink-muted transition-colors hover:text-ink underline decoration-border-subtle"
                          >
                            {plan.is_active ? 'Archive Tier' : 'Publish Tier'}
                          </button>

                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="secondary"
                              onClick={() => openEditModal(plan)}
                              className="h-8 gap-1 px-2.5 text-xs"
                            >
                              <Edit3 className="size-3.5" />
                              <span>Edit</span>
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={plan.subscriber_count > 0}
                              title={
                                plan.subscriber_count > 0
                                  ? 'Cannot delete a plan with active subscribers'
                                  : 'Delete plan'
                              }
                              onClick={() => setDeleteConfirmId(plan.id)}
                              className="h-8 px-2 text-xs text-critical hover:bg-critical-soft disabled:text-ink-faint"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Plan Create / Edit Modal Dialog */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto">
          <div className="relative my-8 w-full max-w-2xl rounded-xl border border-border-subtle bg-surface shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="rounded-md bg-accent-soft p-1.5 text-accent">
                  {editingPlan ? <Edit3 className="size-5" /> : <Plus className="size-5" />}
                </div>
                <div>
                  <h3 className="text-base font-semibold text-ink">
                    {editingPlan ? `Edit Plan: ${editingPlan.name}` : 'Create Subscription Plan'}
                  </h3>
                  <p className="text-xs text-ink-muted">
                    {editingPlan
                      ? 'Modify pricing, limits, and user-facing copy'
                      : 'Define a new tier for your pricing matrix'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-5">
              {/* Core Identifiers */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Plan ID / Slug"
                  hint={
                    editingPlan
                      ? 'Identifier cannot be modified after creation'
                      : 'Lowercase alphanumeric slug (e.g. starter, enterprise)'
                  }
                >
                  <Input
                    required
                    disabled={!!editingPlan}
                    placeholder="e.g. pro-plus"
                    value={formData.id}
                    onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  />
                </Field>

                <Field label="Display Name" hint="Shown on pricing cards and billing headers">
                  <Input
                    required
                    placeholder="e.g. Professional"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Highlight Badge" hint="Optional pill label (e.g. Most Popular, Best Value)">
                  <Input
                    placeholder="e.g. Most Popular"
                    value={formData.badge}
                    onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                  />
                </Field>

                <Field label="Button CTA Text" hint="Text on signup plan card button">
                  <Input
                    required
                    placeholder="e.g. Start Free Trial"
                    value={formData.button_label}
                    onChange={(e) => setFormData({ ...formData, button_label: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Description" hint="Concise summary for target audience">
                <Textarea
                  rows={2}
                  required
                  placeholder="e.g. Tailored for agency pros and outbound teams..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </Field>

              {/* Pricing Section */}
              <div className="rounded-lg border border-border-subtle bg-surface-muted/40 p-4 space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Pricing & Trial Duration
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 items-start">
                  <Field label="Monthly Price ($/mo)">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.monthly_price}
                      onChange={(e) =>
                        setFormData({ ...formData, monthly_price: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </Field>

                  <Field
                    label="Annual Price ($/mo)"
                    hint={
                      formData.annual_price
                        ? `Billed as $${(Number(formData.annual_price) * 12).toFixed(0)}/yr`
                        : undefined
                    }
                  >
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.annual_price}
                      onChange={(e) =>
                        setFormData({ ...formData, annual_price: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </Field>

                  <Field label="Trial Period (Days)">
                    <Input
                      type="number"
                      min="0"
                      required
                      value={formData.trial_days}
                      onChange={(e) =>
                        setFormData({ ...formData, trial_days: parseInt(e.target.value, 10) || 0 })
                      }
                    />
                  </Field>
                </div>
              </div>

              {/* Operational Limits */}
              <div className="rounded-lg border border-border-subtle bg-surface-muted/40 p-4 space-y-4">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Operational Quotas
                </h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Max Active Campaigns">
                    <Input
                      type="number"
                      min="1"
                      required
                      value={formData.max_campaigns}
                      onChange={(e) =>
                        setFormData({ ...formData, max_campaigns: parseInt(e.target.value, 10) || 1 })
                      }
                    />
                  </Field>

                  <Field label="Monthly AI Prospects">
                    <Input
                      type="number"
                      min="50"
                      required
                      value={formData.monthly_ai_prospects}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          monthly_ai_prospects: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </Field>

                  <Field label="Daily Action Limit">
                    <Input
                      type="number"
                      min="5"
                      required
                      value={formData.daily_action_limit}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          daily_action_limit: parseInt(e.target.value, 10) || 0,
                        })
                      }
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 pt-2">
                  <Checkbox
                    label="Smart Pacing"
                    hint="Simulates human timing algorithms"
                    checked={formData.has_smart_pacing}
                    onChange={(e) =>
                      setFormData({ ...formData, has_smart_pacing: e.target.checked })
                    }
                  />
                  <Checkbox
                    label="Dedicated 2FA Proxy"
                    hint="Rotates residential IP address"
                    checked={formData.has_2fa_proxy}
                    onChange={(e) =>
                      setFormData({ ...formData, has_2fa_proxy: e.target.checked })
                    }
                  />
                  <Checkbox
                    label="Custom AI Prompts"
                    hint="Unlocks prompt tone engineering"
                    checked={formData.has_custom_ai_prompts}
                    onChange={(e) =>
                      setFormData({ ...formData, has_custom_ai_prompts: e.target.checked })
                    }
                  />
                </div>
              </div>

              {/* Dynamic Features List */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-ink-muted">
                    Feature Bullet Points ({formData.features.length})
                  </label>
                  <span className="text-xs text-ink-faint">Appears on user registration card</span>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. Dedicated Account Manager..."
                    value={newFeatureText}
                    onChange={(e) => setNewFeatureText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddFeature()
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleAddFeature}
                    className="shrink-0"
                  >
                    Add
                  </Button>
                </div>

                <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-lg border border-border-subtle bg-surface p-2">
                  {formData.features.length === 0 ? (
                    <p className="py-2 text-center text-xs text-ink-faint">
                      No feature bullets added yet.
                    </p>
                  ) : (
                    formData.features.map((feat, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded bg-surface-muted px-2.5 py-1 text-xs"
                      >
                        <span className="truncate text-ink">{feat}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveFeature(idx)}
                          className="ml-2 text-ink-faint hover:text-critical"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Display & Position Controls */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 border-t border-border-subtle pt-4">
                <Field
                  label="Display Position"
                  hint={`Current sequence: #${formData.sort_order}`}
                >
                  <Select
                    value={formData.sort_order}
                    onChange={(e) =>
                      setFormData({ ...formData, sort_order: parseInt(e.target.value, 10) || 1 })
                    }
                  >
                    {positionOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="flex flex-col justify-center space-y-3 pt-2">
                  <Checkbox
                    label="Publicly Active"
                    hint="Show on registration screen"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  <Checkbox
                    label="Recommended Tier"
                    hint="Highlight with brand border & badge"
                    checked={formData.is_recommended}
                    onChange={(e) =>
                      setFormData({ ...formData, is_recommended: e.target.checked })
                    }
                  />
                </div>
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-4">
                <Button type="button" variant="secondary" onClick={closeModal}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  loading={createMutation.isPending || updateMutation.isPending}
                >
                  {editingPlan ? 'Save Changes' : 'Create Plan'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
