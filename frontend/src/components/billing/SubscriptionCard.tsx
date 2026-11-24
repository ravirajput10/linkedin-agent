import { useState, useEffect } from 'react'
import {
  CreditCard,
  ExternalLink,
  Loader2,
  Sparkles,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { billingApi } from '@/services/api'
import type { SubscriptionResponse } from '@/types/api'
import { PlanUpgradeModal } from './PlanUpgradeModal'

interface SubscriptionCardProps {
  subscription: SubscriptionResponse | null
  isLoading: boolean
  onRefresh: () => void
}

export function SubscriptionCard({ subscription, isLoading, onRefresh }: SubscriptionCardProps) {
  const [isPortalLoading, setIsPortalLoading] = useState(false)
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset portal loading state when navigating back from Stripe Billing Portal (bfcache / window focus)
  useEffect(() => {
    const handleRestore = () => {
      setIsPortalLoading(false)
    }

    window.addEventListener('pageshow', handleRestore)
    window.addEventListener('focus', handleRestore)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        handleRestore()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      window.removeEventListener('pageshow', handleRestore)
      window.removeEventListener('focus', handleRestore)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const handleOpenPortal = async () => {
    setIsPortalLoading(true)
    setError(null)
    try {
      const origin = window.location.origin
      const res = await billingApi.createPortalSession({
        return_url: `${origin}/settings?tab=billing`,
      })
      if (res.portal_url) {
        window.location.href = res.portal_url
      } else {
        throw new Error('No portal URL returned by billing server.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch Stripe billing portal.')
      setIsPortalLoading(false)
    }
  }

  if (isLoading) {
    return (
      <Card className="p-6 border border-slate-200 dark:border-border">
        <div className="flex items-center justify-center py-8 text-xs text-slate-400 gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading subscription details...</span>
        </div>
      </Card>
    )
  }

  const planName = subscription?.plan?.name || (subscription?.plan_id ? subscription.plan_id.toUpperCase() : 'STARTER')
  const cycle = subscription?.billing_cycle || 'monthly'
  const isAnnual = cycle.toLowerCase() === 'annual'
  const rawPrice = subscription?.plan
    ? (isAnnual ? subscription.plan.annual_price : subscription.plan.monthly_price)
    : null
  const price = rawPrice !== null && rawPrice !== undefined ? Number(rawPrice) : null
  const currency = (subscription?.plan?.currency || 'USD').toUpperCase()
  const currencySymbol = currency === 'INR' ? '₹' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$'

  const status = subscription?.status || 'trialing'
  const isTrialing = status === 'trialing'
  const isPastDue = status === 'past_due'
  const trialDaysRemaining = subscription?.trial_days_remaining ?? 14

  return (
    <>
      <Card className="p-6 sm:p-7 border border-slate-200/90 dark:border-border rounded-2xl shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xl font-bold text-slate-900 dark:text-white">{planName} Plan</span>
              {price !== null && (
                <span className="inline-flex items-baseline gap-0.5 text-base font-extrabold text-blue-600 dark:text-blue-400 bg-blue-50/70 dark:bg-blue-950/40 px-2.5 py-0.5 rounded-lg border border-blue-200/60 dark:border-blue-800/40">
                  <span>{currencySymbol}{price}</span>
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/{isAnnual ? 'year' : 'month'}</span>
                </span>
              )}
              {isTrialing && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40">
                  <Clock className="h-3 w-3" />
                  <span>14-Day Free Trial</span>
                </span>
              )}
              {status === 'active' && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40">
                  <CheckCircle2 className="h-3 w-3" />
                  <span>Active</span>
                </span>
              )}
              {isPastDue && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/40">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Payment Past Due</span>
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Billed {subscription?.billing_cycle || 'monthly'}. Manage plans, invoices, and payment cards securely through Stripe.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPortalLoading}
              onClick={handleOpenPortal}
              className="text-xs h-9 gap-1.5"
            >
              {isPortalLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Opening Portal...</span>
                </>
              ) : (
                <>
                  <CreditCard className="h-3.5 w-3.5 text-slate-400" />
                  <span>Manage Billing</span>
                  <ExternalLink className="h-3 w-3 text-slate-400" />
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => setIsUpgradeOpen(true)}
              className="text-xs h-9 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Upgrade Plan</span>
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-3 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl">
            {error}
          </div>
        )}

        {isTrialing && (
          <div className="flex items-center justify-between p-3.5 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40 rounded-xl text-xs text-blue-900 dark:text-blue-200">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span>
                You have <strong>{trialDaysRemaining} days remaining</strong> in your free trial.{price !== null ? ` Then ${currencySymbol}${price}/${isAnnual ? 'year' : 'month'} starting after trial.` : ' You will not be charged until the trial ends.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsUpgradeOpen(true)}
              className="font-semibold underline hover:text-blue-700 dark:hover:text-blue-300 shrink-0 ml-2"
            >
              Change Tier
            </button>
          </div>
        )}

        {isPastDue && (
          <div className="flex items-center justify-between p-3.5 bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-900 dark:text-rose-200">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>
                Your last subscription payment was unsuccessful. Background automation is paused until a valid payment method is added.
              </span>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={handleOpenPortal}
              className="bg-rose-600 hover:bg-rose-700 text-white text-xs h-7 px-2.5"
            >
              Update Card
            </Button>
          </div>
        )}

        {/* Operational Quotas Overview */}
        <div className="pt-4 border-t border-slate-100 dark:border-border/60">
          <div className="text-xs font-bold text-slate-900 dark:text-white mb-3 flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5 text-blue-600" />
            <span>Active Plan Entitlements</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-3.5 bg-slate-50 dark:bg-muted/40 rounded-xl border border-slate-100 dark:border-border/40">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Campaigns Quota</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {subscription?.campaigns_limit && subscription.campaigns_limit >= 999
                  ? 'Unlimited'
                  : `${subscription?.campaigns_limit || 5} Active`}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Simultaneous running campaigns</div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-muted/40 rounded-xl border border-slate-100 dark:border-border/40">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Daily Actions Ceiling</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {subscription?.daily_actions_limit || 50} / day
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Likes, comments, and connection notes</div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-muted/40 rounded-xl border border-slate-100 dark:border-border/40">
              <div className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Monthly AI Prospects</div>
              <div className="text-base font-bold text-slate-900 dark:text-white mt-0.5">
                {(subscription?.monthly_prospects_limit || 1000).toLocaleString()} / mo
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Prompt search & AI scoring limit</div>
            </div>
          </div>
        </div>
      </Card>

      <PlanUpgradeModal
        isOpen={isUpgradeOpen}
        onClose={() => {
          setIsUpgradeOpen(false)
          onRefresh()
        }}
        currentPlanId={subscription?.plan_id}
      />
    </>
  )
}

