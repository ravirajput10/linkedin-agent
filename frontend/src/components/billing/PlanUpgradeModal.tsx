import { useState, useEffect } from 'react'
import { Check, Loader2, Sparkles, X, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { billingApi, plansApi } from '@/services/api'
import type { Plan } from '@/types/api'

interface PlanUpgradeModalProps {
  isOpen: boolean
  onClose: () => void
  currentPlanId?: string
}

export function PlanUpgradeModal({ isOpen, onClose, currentPlanId }: PlanUpgradeModalProps) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'annual'>('monthly')
  const [loadingPlanId, setLoadingPlanId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      setLoadingPlanId(null)
      setError(null)
      return
    }
    plansApi
      .list()
      .then((data: Plan[]) => setPlans(data))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to load plans'))
  }, [isOpen])

  // Reset loading state when navigating back from checkout (browser back button / bfcache or window focus)
  useEffect(() => {
    const handleRestore = () => {
      setLoadingPlanId(null)
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

  if (!isOpen) return null

  const handleCheckout = async (planId: string) => {
    setLoadingPlanId(planId)
    setError(null)
    try {
      const origin = window.location.origin
      const res = await billingApi.createCheckoutSession({
        plan_id: planId,
        billing_cycle: billingCycle,
        success_url: `${origin}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}&status=success`,
        cancel_url: `${origin}/settings?tab=billing&status=cancelled`,
      })
      if (res.checkout_url) {
        window.location.href = res.checkout_url
      } else {
        throw new Error('No checkout URL returned from payment server.')
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Failed to launch checkout.'
      if (msg.includes('Request req_') || msg.includes('http') || msg.length > 150) {
        msg = 'Unable to initiate checkout at this time. Please try again shortly or contact support.'
      }
      setError(msg)
      setLoadingPlanId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white dark:bg-card border border-slate-200 dark:border-border rounded-2xl shadow-2xl p-6 sm:p-8 max-h-[92vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="text-center max-w-xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 text-xs font-semibold uppercase tracking-wider mb-2">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Select Your Plan</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            Scale Your LinkedIn Outreach Safely
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-2">
            All plans include a full 14-day free trial. Cancel or switch anytime from your billing portal.
          </p>

          {/* Billing Switch */}
          <div className="mt-5 inline-flex items-center p-1 bg-slate-100 dark:bg-muted rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => setBillingCycle('monthly')}
              className={`px-3.5 py-1.5 rounded-lg transition-all ${
                billingCycle === 'monthly'
                  ? 'bg-white dark:bg-card text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Monthly Billing
            </button>
            <button
              type="button"
              onClick={() => setBillingCycle('annual')}
              className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                billingCycle === 'annual'
                  ? 'bg-white dark:bg-card text-slate-900 dark:text-white shadow-xs font-semibold'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span>Annual Billing</span>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded-full">
                Save 25%
              </span>
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 max-w-xl mx-auto p-3 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-xl text-center">
            {error}
          </div>
        )}

        {/* Pricing Cards Grid */}
        <div className="mt-7 grid grid-cols-1 md:grid-cols-3 gap-5">
          {plans.map((p) => {
            const isCurrent = p.id.toLowerCase() === currentPlanId?.toLowerCase()
            const isGrowth = p.id.toLowerCase() === 'growth'
            const price = billingCycle === 'annual' ? p.annual_price : p.monthly_price

            return (
              <Card
                key={p.id}
                className={`relative p-5 sm:p-6 rounded-2xl flex flex-col justify-between transition-all ${
                  isGrowth
                    ? 'border-2 border-blue-600 dark:border-blue-500 shadow-lg shadow-blue-500/10 bg-slate-50/50 dark:bg-slate-900/30'
                    : 'border border-slate-200 dark:border-border'
                }`}
              >
                {isGrowth && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-xs">
                    Most Popular
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{p.name}</h3>
                    {p.badge && !isGrowth && (
                      <span className="text-[10px] font-medium bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-full">
                        {p.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 min-h-[32px]">
                    {p.description}
                  </p>

                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
                      ${price}
                    </span>
                    <span className="text-xs text-slate-500">
                      /{billingCycle === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </div>

                  <div className="mt-5 space-y-2.5 pt-4 border-t border-slate-100 dark:border-border/60">
                    <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Included Quotas
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                      <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span>{p.max_campaigns >= 999 ? 'Unlimited' : p.max_campaigns} Active Campaigns</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                      <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span>{p.daily_action_limit} Daily Actions (Human Pacing)</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                      <Check className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      <span>{p.monthly_ai_prospects.toLocaleString()} AI Prospects / mo</span>
                    </div>
                    {p.features && p.features.slice(0, 3).map((feat, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>{feat}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-6 pt-2">
                  <Button
                    type="button"
                    disabled={isCurrent || loadingPlanId === p.id}
                    onClick={() => handleCheckout(p.id)}
                    className={`w-full text-xs font-semibold h-9 rounded-xl transition-all ${
                      isCurrent
                        ? 'bg-slate-100 dark:bg-muted text-slate-400 cursor-default'
                        : isGrowth
                        ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
                        : 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900'
                    }`}
                  >
                    {loadingPlanId === p.id ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        <span>Launching Checkout...</span>
                      </>
                    ) : isCurrent ? (
                      'Current Plan'
                    ) : (
                      'Start Free 14-Day Trial'
                    )}
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-slate-100 dark:border-border/60 flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-500" />
          <span>Secured by Stripe. No charges during your 14-day trial period.</span>
        </div>
      </div>
    </div>
  )
}
