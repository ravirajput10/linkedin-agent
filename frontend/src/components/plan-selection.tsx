import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, Sparkles, Zap, Shield, ArrowLeft, ArrowRight, Building2, UserCheck, Layers } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { plansApi } from "@/services/api"
import { ApiRequestError } from "@/services/client"
import type { Plan as ApiPlan } from "@/types/api"

export interface DisplayPlan {
  id: string
  name: string
  badge?: string
  description: string
  monthlyPrice: number
  annualPrice: number
  currency: string
  trialDays: number
  icon: typeof Zap
  buttonLabel: string
  features: string[]
  recommended?: boolean
}

function getCurrencySymbol(currency: string = "USD"): string {
  switch (currency.toUpperCase()) {
    case "EUR": return "€"
    case "GBP": return "£"
    case "INR": return "₹"
    case "JPY": return "¥"
    case "CAD": return "CA$"
    case "AUD": return "A$"
    default: return "$"
  }
}

function getPlanIcon(planId: string, isRecommended?: boolean) {
  if (isRecommended) return Sparkles
  if (planId.includes("pro") || planId.includes("growth")) return Sparkles
  if (planId.includes("enterprise") || planId.includes("agency")) return Building2
  if (planId.includes("scale") || planId.includes("team")) return Layers
  return Zap
}

interface PlanSelectionProps {
  userEmail: string
  userName: string
  onSelectPlan: (planId: string, billingCycle: "monthly" | "annual") => void
  onBack: () => void
  submitting: boolean
  error: unknown
}

export function PlanSelection({
  userEmail,
  userName,
  onSelectPlan,
  onBack,
  submitting,
  error,
}: PlanSelectionProps) {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly")

  const { data: serverPlans, isLoading: isPlansLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: plansApi.list,
    staleTime: 0,
    refetchOnMount: 'always',
  })

  // Format plans exclusively from the database
  const displayPlans = useMemo<DisplayPlan[]>(() => {
    if (!serverPlans || serverPlans.length === 0) {
      return []
    }
    return serverPlans.map((p: ApiPlan) => ({
      id: p.id,
      name: p.name,
      badge: p.badge || (p.is_recommended ? "Recommended" : undefined),
      description: p.description,
      monthlyPrice: Number(p.monthly_price),
      annualPrice: Number(p.annual_price),
      currency: p.currency || "USD",
      trialDays: Number(p.trial_days ?? 14),
      icon: getPlanIcon(p.id, p.is_recommended),
      buttonLabel: p.button_label || "Start Free Trial",
      features: p.features && p.features.length > 0 ? p.features : [],
      recommended: Boolean(p.is_recommended),
    }))
  }, [serverPlans])

  // Determine active selected plan: user selection > recommended tier > first active plan
  const effectiveSelectedId = useMemo(() => {
    if (selectedPlanId && displayPlans.some((p) => p.id === selectedPlanId)) {
      return selectedPlanId
    }
    const rec = displayPlans.find((p) => p.recommended)
    return rec ? rec.id : (displayPlans[0]?.id || "")
  }, [selectedPlanId, displayPlans])

  const savingsPercent = useMemo(() => {
    const discounted = displayPlans.filter((p) => p.monthlyPrice > p.annualPrice)
    if (discounted.length === 0) return 0
    return Math.max(
      ...discounted.map((p) => Math.round(((p.monthlyPrice - p.annualPrice) / p.monthlyPrice) * 100))
    )
  }, [displayPlans])

  const activePlan = displayPlans.find((p) => p.id === effectiveSelectedId) || displayPlans[0]
  const activeTrialDays = activePlan?.trialDays ?? 14

  const errorMessage =
    error instanceof ApiRequestError
      ? error.message
      : error instanceof Error
        ? error.message
        : error
          ? "Failed to complete registration. Please try again."
          : null

  return (
    <div className="w-full max-w-7xl mx-auto space-y-6 animate-in fade-in-50 duration-300">
      {/* Header & Steps */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase">
          <UserCheck className="size-3.5" />
          Choose Your Plan
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Select the plan that fits your growth
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-lg mx-auto">
          Welcome, <span className="font-semibold text-foreground">{userName || userEmail}</span>! {activeTrialDays > 0 ? `Every plan includes a ${activeTrialDays}-day risk-free trial. No charge today.` : "Get started with full access immediately."}
        </p>

        {/* Billing cycle toggle */}
        <div className="flex items-center justify-center pt-1">
          <div className="inline-flex items-center gap-1 p-1 bg-muted rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setBillingCycle("monthly")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-md transition-all",
                billingCycle === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle("annual")}
              className={cn(
                "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-md transition-all",
                billingCycle === "annual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span>Annual Billing</span>
              {savingsPercent > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary text-primary-foreground">
                  Save {savingsPercent}%
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive flex items-center justify-between"
        >
          <span>{errorMessage}</span>
          <Button variant="outline" size="sm" onClick={onBack}>
            Edit Account Info
          </Button>
        </div>
      )}

      {/* Plan Cards Grid */}
      {isPlansLoading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <span className="w-7 h-7 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          <p className="text-xs font-medium">Loading subscription plans...</p>
        </div>
      ) : displayPlans.length === 0 ? (
        <div className="rounded-xl border border-border p-8 text-center bg-card/60 space-y-3">
          <p className="text-sm font-medium text-foreground">No subscription plans available</p>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Please contact an administrator or check back later once subscription tiers are published.
          </p>
          <Button variant="outline" size="sm" onClick={onBack} className="mt-2">
            Back to account details
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 items-stretch pt-3">
          {displayPlans.map((plan) => {
            const isSelected = effectiveSelectedId === plan.id
            const isRecommended = Boolean(plan.recommended)
            const Icon = plan.icon
            const price = billingCycle === "annual" ? plan.annualPrice : plan.monthlyPrice
            const isThisButtonLoading = submitting && effectiveSelectedId === plan.id

            return (
              <Card
                key={plan.id}
                onClick={() => setSelectedPlanId(plan.id)}
                className={cn(
                  "relative flex flex-col p-5 rounded-xl cursor-pointer transition-all border-2 text-left overflow-visible",
                  isSelected
                    ? "border-primary shadow-lg ring-2 ring-primary/20 bg-background scale-[1.01]"
                    : isRecommended
                      ? "border-primary/60 hover:border-primary shadow-md bg-card/90 ring-1 ring-primary/20"
                      : "border-border hover:border-border/80 bg-card/70 hover:bg-card opacity-90 hover:opacity-100"
                )}
              >
                {/* Top Badge (visible without clipping due to overflow-visible) */}
                {(plan.badge || isRecommended) && (
                  <div
                    className={cn(
                      "absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase shadow-sm z-10 flex items-center gap-1",
                      isRecommended
                        ? "bg-primary text-primary-foreground shadow-md ring-1 ring-primary/30"
                        : "bg-slate-700 text-white"
                    )}
                  >
                    {isRecommended && <Sparkles className="size-3" />}
                    {plan.badge || "Recommended"}
                  </div>
                )}

                {/* Card Header */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <Icon className="size-4.5" />
                  </div>
                  <div
                    className={cn(
                      "size-5 rounded-full border-2 flex items-center justify-center transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : isRecommended
                          ? "border-primary/50 text-transparent"
                          : "border-muted-foreground/30"
                    )}
                  >
                    {isSelected && <Check className="size-3 stroke-[3]" />}
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-bold text-foreground">{plan.name}</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground min-h-[30px] leading-snug">
                    {plan.description}
                  </p>
                </div>

                {/* Price */}
                <div className="my-3.5 pb-3 border-b border-border">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl sm:text-3xl font-extrabold text-foreground">
                      {getCurrencySymbol(plan.currency)}{price}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">/ month</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {billingCycle === "annual"
                      ? `Billed annually (${getCurrencySymbol(plan.currency)}${price * 12}/yr)`
                      : "Billed monthly, cancel anytime"}
                  </p>
                </div>

                {/* Features List */}
                <div className="space-y-2 flex-1 mb-5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    What&apos;s included:
                  </p>
                  <ul className="space-y-1.5 text-xs">
                    {plan.features.map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-foreground/90 leading-tight">
                        <Check className="size-3.5 text-primary shrink-0 mt-0.5" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Action Button - Fully visible on the card */}
                <div className="mt-auto pt-2">
                  <Button
                    type="button"
                    variant={isSelected || isRecommended ? "default" : "outline"}
                    disabled={submitting}
                    className={cn(
                      "w-full text-xs font-semibold h-10 shadow-sm transition-all",
                      (isSelected || isRecommended) && "shadow-md"
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedPlanId(plan.id)
                      onSelectPlan(plan.id, billingCycle)
                    }}
                  >
                    {isThisButtonLoading ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        Setting up...
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        {plan.buttonLabel}
                        <ArrowRight className="size-3.5" />
                      </span>
                    )}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Footer Controls & Assurance */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <ArrowLeft className="size-3.5" />
          Back to account details
        </button>

        <div className="flex flex-wrap items-center justify-center gap-4 text-[11px]">
          <span className="inline-flex items-center gap-1">
            <Shield className="size-3.5 text-primary" />
            {activeTrialDays > 0 ? `${activeTrialDays}-Day Full Access Trial` : "Full Access Included"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Check className="size-3.5 text-primary" />
            No Credit Card Required
          </span>
          <span className="inline-flex items-center gap-1">
            <Sparkles className="size-3.5 text-primary" />
            Cancel Anytime
          </span>
        </div>
      </div>
    </div>
  )
}
