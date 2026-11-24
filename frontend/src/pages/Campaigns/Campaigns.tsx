import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Layers, Plus } from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import {
  ErrorState,
  LoadingState,
} from '@/components/ui'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CAMPAIGN_TEMPLATES } from '@/data/campaignTemplates'
import { campaignsApi } from '@/services/api'

export function Campaigns() {
  const auth = useOptionalAuth()
  const isAdmin = auth?.isAdmin ?? false

  if (isAdmin) {
    return <Navigate to="/admin/campaigns" replace />
  }

  return <UserCampaigns />
}

/**
 * =========================================================================
 * USER CAMPAIGNS (Active campaigns table + Pre-built sequence templates)
 * =========================================================================
 */
function UserCampaigns() {
  const [activeTab, setActiveTab] = useState<'active' | 'templates'>('active')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list({ page_size: 100 }),
  })

  const campaignsList =
    data?.items && data.items.length > 0
      ? data.items.map((c) => {
          const isRunning = c.status === 'RUNNING'
          const isPaused = c.status === 'PAUSED'
          const criteriaTitles = c.criteria?.job_titles?.length
            ? c.criteria.job_titles.join(', ')
            : 'Target audience'
          const likeCount = c.criteria?.initial_posts_to_like ?? 2
          const sequenceDesc = `Like ${likeCount} → Comment with AI → Connect`

          return {
            id: c.id,
            name: c.name,
            audience: criteriaTitles,
            sequenceDesc,
            progress: isRunning ? 60 : isPaused ? 100 : 20,
            stepDesc: isRunning ? 'In progress' : isPaused ? 'Paused' : 'Configured',
            todayActions: isRunning ? `${c.criteria?.max_people_per_day ?? 15} actions` : '—',
            status: isRunning ? 'Running' : isPaused ? 'Paused' : 'Needs review',
          }
        })
      : []

  return (
    <div className="space-y-2 pb-10 text-slate-900 dark:text-slate-100">
      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Campaigns
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Active and automated outreach sequences across your target audiences.
          </p>
        </div>

        <Link to="/campaigns/new">
          <Button
            size="sm"
            className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>New campaign</span>
          </Button>
        </Link>
      </div>

      {/* ================= TAB SWITCHER ================= */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('active')}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'active'
              ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Active campaigns</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              activeTab === 'active'
                ? 'bg-slate-700 dark:bg-slate-200 text-white dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
            }`}
          >
            {campaignsList.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
            activeTab === 'templates'
              ? 'bg-[#2445C8] text-white shadow-2xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          <span>Sequence templates</span>
          <span
            className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
              activeTab === 'templates'
                ? 'bg-white/20 text-white'
                : 'bg-blue-50 text-[#2445C8] dark:bg-blue-950/60 dark:text-blue-300'
            }`}
          >
            {CAMPAIGN_TEMPLATES.length}
          </span>
        </button>
      </div>

      {/* ================= TEMPLATES TAB ================= */}
      {activeTab === 'templates' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
          {CAMPAIGN_TEMPLATES.map((tmpl) => (
            <Card
              key={tmpl.id}
              className="rounded-xl border border-slate-200/90 dark:border-border p-5 shadow-2xs bg-white dark:bg-card flex flex-col justify-between space-y-4 hover:border-slate-300 dark:hover:border-slate-700 transition-all"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${tmpl.badgeColor}`}>
                    {tmpl.category}
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    Limit: {tmpl.recommendedLimit}
                  </span>
                </div>

                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {tmpl.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    {tmpl.summary}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                    Sequence Workflow
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    {tmpl.sequenceFlow.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <span className="px-2 py-1 rounded bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          {step}
                        </span>
                        {idx < tmpl.sequenceFlow.length - 1 && (
                          <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end">
                <Link to={`/campaigns/new?template=${tmpl.id}`}>
                  <Button
                    size="sm"
                    className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs flex items-center gap-1.5"
                  >
                    <span>Use template</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        /* ================= ACTIVE CAMPAIGNS TABLE CARD ================= */
        <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
          {isLoading ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : campaignsList.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-muted flex items-center justify-center mx-auto text-slate-400">
                <Layers className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                No campaigns created yet
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Create your first outreach campaign with a plain-English prompt or choose a pre-built sequence template.
              </p>
              <div className="pt-2">
                <Link to="/campaigns/new">
                  <Button size="sm" className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs h-8 px-4 rounded-lg">
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Create Campaign
                  </Button>
                </Link>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-b border-slate-100 dark:border-border/60 hover:bg-transparent">
                    <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      CAMPAIGN
                    </TableHead>
                    <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      AUDIENCE
                    </TableHead>
                    <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      PROGRESS
                    </TableHead>
                    <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      TODAY
                    </TableHead>
                    <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">
                      STATUS
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignsList.map((c) => (
                    <TableRow
                      key={c.id}
                      className="border-b border-slate-100 dark:border-border/40 hover:bg-slate-50/70 dark:hover:bg-muted/20 transition-colors"
                    >
                      <TableCell className="py-3 px-3">
                        <Link
                          to={`/campaigns/${c.id}`}
                          className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400 block"
                        >
                          {c.name}
                        </Link>
                        <span className="text-[11px] text-slate-400 block mt-0.5">
                          {c.sequenceDesc}
                        </span>
                      </TableCell>

                      <TableCell className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                        {c.audience}
                      </TableCell>

                      <TableCell className="py-3 px-3">
                        <div className="w-24 bg-slate-100 dark:bg-muted rounded-full h-1.5 mb-1 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              c.status === 'Needs review'
                                ? 'bg-amber-500'
                                : c.status === 'Paused'
                                ? 'bg-slate-400'
                                : 'bg-[#2445C8]'
                            }`}
                            style={{ width: `${c.progress}%` }}
                          />
                        </div>
                        <span
                          className={`text-[11px] ${
                            c.status === 'Needs review'
                              ? 'text-amber-600 font-medium'
                              : 'text-slate-500'
                          }`}
                        >
                          {c.stepDesc}
                        </span>
                      </TableCell>

                      <TableCell className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300">
                        {c.todayActions}
                      </TableCell>

                      <TableCell className="py-3 px-3 text-right">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                            c.status === 'Running'
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-emerald-200/80 dark:border-emerald-800'
                            : c.status === 'Needs review'
                              ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border-amber-200/80 dark:border-amber-800'
                            : 'bg-slate-100 dark:bg-muted text-slate-600 dark:text-slate-400 border-slate-200 dark:border-border'
                          }`}
                        >
                          {c.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

