import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import { useOptionalAuth } from '@/auth/AuthContext'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { authApi } from '@/services/api'

export function DangerZone() {
  const auth = useOptionalAuth()
  const navigate = useNavigate()
  const [isResetting, setIsResetting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleResetOnboarding = async () => {
    setIsResetting(true)
    setError(null)
    try {
      localStorage.removeItem('linkedin-agent.approval-mode')
      await authApi.updateOnboarding({ step: 1 })
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset onboarding.')
      setIsResetting(false)
    }
  }

  const handleDeleteWorkspace = async () => {
    if (
      !window.confirm(
        'Are you sure you want to delete your entire workspace and account? This action is irreversible.'
      )
    ) {
      return
    }
    setIsDeleting(true)
    setError(null)
    try {
      localStorage.removeItem('linkedin-agent.approval-mode')
      await authApi.deleteWorkspace()
      navigate('/', { replace: true })
      await auth?.logout()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace.')
      setIsDeleting(false)
    }
  }

  return (
    <Card className="col-span-full p-6 border-red-200 dark:border-red-900/60 bg-red-50/20 dark:bg-red-950/10 rounded-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-red-100 dark:border-red-900/30">
        <div className="flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
            <AlertTriangle className="size-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-red-900 dark:text-red-300">Danger Zone</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Re-test the setup wizard or permanently delete your workspace and all data.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg text-xs bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
          {error}
        </div>
      )}

      <div className="mt-4 divide-y divide-red-100 dark:divide-red-900/30">
        {/* Action 1: Re-run Onboarding Setup */}
        <div className="py-3.5 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <RotateCcw className="size-3.5 text-slate-500" />
              Re-run Onboarding Wizard
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Reset your progress to Step 1 to test or re-configure all 3 setup steps (Sign in → Connect account → Approval mode).
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetOnboarding}
            disabled={isResetting}
            className="shrink-0 text-xs font-medium border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-muted"
          >
            {isResetting ? 'Resetting...' : 'Re-run Setup Wizard'}
          </Button>
        </div>

        {/* Action 2: Delete Workspace (FR-1.10) */}
        <div className="py-3.5 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs sm:text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
              <Trash2 className="size-3.5 text-red-600" />
              Delete Workspace & Account
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Permanently delete your profile, campaigns, settings, and all synced LinkedIn data (FR-1.10).
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleDeleteWorkspace}
            disabled={isDeleting}
            className="shrink-0 text-xs font-medium bg-red-600 hover:bg-red-700 text-white"
          >
            {isDeleting ? 'Deleting...' : 'Delete Workspace'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
