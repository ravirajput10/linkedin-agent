import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles,
  Plus,
  X,
  CheckCircle2,
  Upload,
  RefreshCw,
  Copy,
  Archive,
  Trash2,
  Send,
  AlertCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { audiencesApi, campaignsApi } from '@/services/api'
import type {
  AudienceCandidate,
  AudienceRead,
  FilterChip,
} from '@/types/api'

export function Audiences() {
  const queryClient = useQueryClient()

  // 1. Fetch live saved audiences from database (FR-2.8)
  const { data: dbAudiences = [], isLoading: isLoadingAudiences } = useQuery({
    queryKey: ['audiences'],
    queryFn: () => audiencesApi.list(),
  })

  // 2. Fetch live campaigns for assignment (FR-2.7)
  const { data: liveCampaignsData } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => campaignsApi.list({ page_size: 50 }),
  })

  const [selectedAudienceId, setSelectedAudienceId] = useState<number | null>(null)

  // Sync selected audience id with loaded audiences
  useEffect(() => {
    if (dbAudiences.length === 0) {
      if (selectedAudienceId !== null) {
        setSelectedAudienceId(null)
      }
    } else {
      const exists = dbAudiences.some((a) => a.id === selectedAudienceId)
      if (!exists) {
        setSelectedAudienceId(dbAudiences[0].id)
      }
    }
  }, [dbAudiences, selectedAudienceId])

  // 3. Fetch active audience detail and member list (FR-2.8)
  const isAudienceValid = selectedAudienceId !== null && dbAudiences.some((a) => a.id === selectedAudienceId)
  const { data: activeAudienceDetail } = useQuery({
    queryKey: ['audience-detail', selectedAudienceId],
    queryFn: () => (selectedAudienceId && isAudienceValid ? audiencesApi.get(selectedAudienceId) : null),
    enabled: isAudienceValid,
  })

  const activeAudience = useMemo<AudienceRead | null>(() => {
    if (!selectedAudienceId || dbAudiences.length === 0) return null
    return dbAudiences.find((a) => a.id === selectedAudienceId) || null
  }, [dbAudiences, selectedAudienceId])

  // Local state for active filters & prompt
  const [promptText, setPromptText] = useState<string>('')
  const [activeFilters, setActiveFilters] = useState<FilterChip[]>([])
  const [matches, setMatches] = useState<AudienceCandidate[]>([])
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([])
  const [isParsingPrompt, setIsParsingPrompt] = useState<boolean>(false)
  const [isSearching, setIsSearching] = useState<boolean>(false)
  const [notification, setNotification] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Exclusion toggles (FR-2.6)
  const [excludeConnections, setExcludeConnections] = useState<boolean>(true)
  const [excludeActiveCampaigns, setExcludeActiveCampaigns] = useState<boolean>(true)

  // Dialogs
  const [isNewAudienceOpen, setIsNewAudienceOpen] = useState(false)
  const [newAudienceName, setNewAudienceName] = useState('')
  const [newAudiencePrompt, setNewAudiencePrompt] = useState('')

  const [isAddFilterOpen, setIsAddFilterOpen] = useState(false)
  const [newFilterKey, setNewFilterKey] = useState('')
  const [newFilterValue, setNewFilterValue] = useState('')

  const [isAssignCampaignOpen, setIsAssignCampaignOpen] = useState(false)
  const [targetCampaignId, setTargetCampaignId] = useState<number | null>(null)

  const [isCsvImportOpen, setIsCsvImportOpen] = useState(false)
  const [csvText, setCsvText] = useState('')

  // When active audience changes, update state
  useEffect(() => {
    if (activeAudience) {
      if (activeAudience.original_prompt) {
        setPromptText(activeAudience.original_prompt)
      }
      if (activeAudience.filters_json && Object.keys(activeAudience.filters_json).length > 0) {
        const chips: FilterChip[] = []
        for (const [k, v] of Object.entries(activeAudience.filters_json)) {
          if (Array.isArray(v) && v.length > 0) {
            chips.push({ key: k.replace(/_/g, ' '), value: v.join(', ') })
          } else if (typeof v === 'string' && v) {
            chips.push({ key: k.replace(/_/g, ' '), value: v })
          }
        }
        if (chips.length > 0) setActiveFilters(chips)
      }
    }
  }, [activeAudience])

  // Populate matches from active audience members
  useEffect(() => {
    if (activeAudienceDetail?.members && activeAudienceDetail.members.length > 0) {
      setMatches(activeAudienceDetail.members)
    }
  }, [activeAudienceDetail])

  const showNotification = (msg: string) => {
    setNotification(msg)
    setTimeout(() => setNotification(null), 3500)
  }

  const showError = (msg: string) => {
    setErrorMessage(msg)
    setTimeout(() => setErrorMessage(null), 4500)
  }

  // 4. FR-2.1 & FR-2.2: Convert prompt to structured filters using LLM
  const handleGenerateFilters = async () => {
    if (!promptText.trim()) return
    setIsParsingPrompt(true)
    try {
      const res = await audiencesApi.parsePrompt(promptText.trim())
      if (res.filter_chips && res.filter_chips.length > 0) {
        setActiveFilters(res.filter_chips)
        showNotification('AI parsed your prompt into structured filters.')
      }
    } catch (err) {
      console.error('Failed to parse audience prompt:', err)
      showError('Could not parse prompt. Please check your network and try again.')
    } finally {
      setIsParsingPrompt(false)
    }
  }

  // 5. FR-2.4 & FR-2.5: LinkedIn search via user's session with fit scoring
  const handleFindPeople = async () => {
    setIsSearching(true)
    try {
      const filtersObj: Record<string, string[]> = {}
      for (const f of activeFilters) {
        filtersObj[f.key] = f.value.split(',').map((s) => s.trim())
      }

      const res = await audiencesApi.search({
        prompt: promptText,
        filters: filtersObj,
        audience_id: activeAudience?.id ?? undefined,
        exclude_connections: excludeConnections,
        exclude_active_campaigns: excludeActiveCampaigns,
        limit: 25,
      })

      setMatches(res.candidates)
      showNotification(`Profile scan complete: found ${res.candidates.length} matching prospects.`)
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      queryClient.invalidateQueries({ queryKey: ['audience-detail', selectedAudienceId] })
    } catch (err: any) {
      console.error('Search error:', err)
      showError(err?.message || 'Error executing search. Ensure daily profile limits are not exceeded.')
    } finally {
      setIsSearching(false)
    }
  }

  // 6. FR-2.8: Save audience
  const handleSaveAudience = async () => {
    if (!activeAudience) {
      const suggestedName =
        activeFilters.length > 0
          ? activeFilters.slice(0, 2).map((f) => f.value).join(' · ')
          : promptText.slice(0, 30) || 'My Target Audience'
      setNewAudienceName(suggestedName)
      setNewAudiencePrompt(promptText)
      setIsNewAudienceOpen(true)
      return
    }

    try {
      const filtersObj: Record<string, string> = {}
      for (const f of activeFilters) {
        filtersObj[f.key] = f.value
      }

      const memberPersonIds = matches
        .map((m) => m.person_id)
        .filter((id): id is number => typeof id === 'number' && !isNaN(id))

      await audiencesApi.update(activeAudience.id, {
        original_prompt: promptText,
        filters_json: filtersObj,
        member_person_ids: memberPersonIds.length > 0 ? memberPersonIds : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      queryClient.invalidateQueries({ queryKey: ['audience-detail', activeAudience.id] })
      showNotification(`Audience "${activeAudience.name}" saved successfully.`)
    } catch (err: any) {
      console.error('Failed to save audience:', err)
      showError(err?.message || 'Could not save audience.')
    }
  }

  // 7. FR-2.8: Create new audience
  const handleCreateAudience = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newAudienceName.trim()) return

    try {
      const memberPersonIds = matches
        .map((m) => m.person_id)
        .filter((id): id is number => typeof id === 'number' && !isNaN(id))

      const created = await audiencesApi.create({
        name: newAudienceName.trim(),
        original_prompt: newAudiencePrompt.trim() || promptText,
        filters_json: activeFilters.reduce((acc, f) => ({ ...acc, [f.key]: f.value }), {}),
        refresh_schedule: 'daily',
        member_person_ids: memberPersonIds.length > 0 ? memberPersonIds : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      setSelectedAudienceId(created.id)
      setIsNewAudienceOpen(false)
      setNewAudienceName('')
      setNewAudiencePrompt('')
      showNotification(`Created audience "${created.name}".`)
    } catch (err: any) {
      console.error('Failed to create audience:', err)
      showError(err?.message || 'Could not create audience.')
    }
  }


  // 8. FR-2.8: Duplicate audience
  const handleDuplicate = async () => {
    if (!selectedAudienceId) return
    try {
      const duplicated = await audiencesApi.duplicate(selectedAudienceId)
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      setSelectedAudienceId(duplicated.id)
      showNotification(`Duplicated audience "${duplicated.name}".`)
    } catch (err) {
      console.error('Failed to duplicate:', err)
      showError('Could not duplicate audience.')
    }
  }

  // 9. FR-2.8: Archive audience
  const handleArchive = async () => {
    if (!selectedAudienceId) return
    try {
      const res = await audiencesApi.archive(selectedAudienceId)
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      showNotification(res.is_archived ? 'Audience archived.' : 'Audience unarchived.')
    } catch (err) {
      console.error('Failed to archive:', err)
      showError('Could not toggle archive.')
    }
  }

  // 10. FR-2.8: Delete audience
  const handleDelete = async () => {
    if (!selectedAudienceId) return
    if (!confirm('Are you sure you want to delete this audience?')) return
    try {
      await audiencesApi.delete(selectedAudienceId)
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      setSelectedAudienceId(null)
      showNotification('Audience deleted.')
    } catch (err) {
      console.error('Failed to delete audience:', err)
      showError('Could not delete audience.')
    }
  }

  // 11. FR-2.9: Refresh audience
  const handleRefreshAudience = async () => {
    if (!selectedAudienceId) return
    setIsSearching(true)
    try {
      const updated = await audiencesApi.refresh(selectedAudienceId)
      setMatches(updated.members)
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      showNotification('Audience refreshed with latest LinkedIn search results.')
    } catch (err: any) {
      console.error('Failed to refresh audience:', err)
      showError(err?.message || 'Failed to refresh audience.')
    } finally {
      setIsSearching(false)
    }
  }

  // 12. FR-2.7: Exclude selected
  const handleExcludeSelected = async () => {
    if (!selectedAudienceId || selectedCandidateIds.length === 0) return
    try {
      const personIds = selectedCandidateIds.map((id) => Number(id)).filter((id) => !isNaN(id))
      await audiencesApi.exclude(selectedAudienceId, personIds, 'Excluded by user')
      setMatches((prev) => prev.filter((m) => !selectedCandidateIds.includes(m.id)))
      setSelectedCandidateIds([])
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      showNotification(`Excluded ${personIds.length} candidate(s).`)
    } catch (err) {
      console.error('Failed to exclude:', err)
      showError('Could not exclude candidates.')
    }
  }

  // 13. FR-2.7: Assign to campaign
  const handleAssignToCampaign = async () => {
    if (!selectedAudienceId || !targetCampaignId || selectedCandidateIds.length === 0) return
    try {
      const personIds = selectedCandidateIds.map((id) => Number(id)).filter((id) => !isNaN(id))
      await audiencesApi.assignCampaign(selectedAudienceId, targetCampaignId, personIds)
      setIsAssignCampaignOpen(false)
      setSelectedCandidateIds([])
      showNotification(`Added ${personIds.length} candidate(s) to campaign!`)
    } catch (err) {
      console.error('Failed to assign candidates:', err)
      showError('Could not assign candidates to campaign.')
    }
  }

  // 14. FR-2.10: CSV Import
  const handleImportCsv = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!csvText.trim()) return
    try {
      const res = await audiencesApi.importCsv(csvText.trim(), selectedAudienceId ?? undefined)
      if (res.prospects && res.prospects.length > 0) {
        setMatches((prev) => [...res.prospects, ...prev])
      }
      setIsCsvImportOpen(false)
      setCsvText('')
      queryClient.invalidateQueries({ queryKey: ['audiences'] })
      showNotification(`Imported ${res.imported_count} prospects from CSV (${res.skipped_count} skipped).`)
    } catch (err) {
      console.error('Failed to import CSV:', err)
      showError('Could not import CSV.')
    }
  }

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedCandidateIds(matches.map((m) => m.id))
    } else {
      setSelectedCandidateIds([])
    }
  }

  const toggleCandidate = (id: string, checked: boolean) => {
    if (checked) {
      setSelectedCandidateIds((prev) => [...prev, id])
    } else {
      setSelectedCandidateIds((prev) => prev.filter((item) => item !== id))
    }
  }

  const handleAddFilter = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFilterKey.trim() || !newFilterValue.trim()) return
    setActiveFilters((prev) => [
      ...prev,
      { key: newFilterKey.trim(), value: newFilterValue.trim() },
    ])
    setIsAddFilterOpen(false)
    setNewFilterKey('')
    setNewFilterValue('')
    showNotification(`Added filter: ${newFilterKey.trim()}`)
  }

  const handleRemoveFilter = (index: number) => {
    setActiveFilters((prev) => prev.filter((_, i) => i !== index))
  }

  const allSelected = matches.length > 0 && selectedCandidateIds.length === matches.length

  return (
    <div className="space-y-2 pb-10 text-slate-900 dark:text-slate-100">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs text-white shadow-xl dark:bg-slate-100 dark:text-slate-900 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
          <span>{notification}</span>
        </div>
      )}

      {errorMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-xs text-white shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <AlertCircle className="h-4 w-4 text-white" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Audiences
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Describe the people you want to reach. The agent turns it into filters and finds matching profiles.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsCsvImportOpen(true)}
            className="shadow-2xs font-semibold text-xs h-8 px-3"
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            <span>Import CSV</span>
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setNewAudienceName('')
              setNewAudiencePrompt(promptText)
              setIsNewAudienceOpen(true)
            }}
            className="bg-[#2445C8] hover:bg-[#1d38a8] text-white font-semibold text-xs h-8 px-3.5 shadow-2xs"
          >
            <Plus className="h-3.5 w-3.5 mr-1 stroke-[2.5]" />
            <span>New audience</span>
          </Button>

        </div>
      </div>

      {/* ================= MAIN 2-COLUMN LAYOUT ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2 items-start">
        {/* ---------------- LEFT COLUMN: SAVED AUDIENCES ---------------- */}
        <div className="lg:col-span-3 space-y-2">
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-3 sm:p-4 shadow-2xs bg-white dark:bg-card ring-0">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] sm:text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                SAVED AUDIENCES ({dbAudiences.length})
              </p>
              {isLoadingAudiences && (
                <span className="inline-block size-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
              )}
            </div>

            <div className="space-y-1">
              {dbAudiences.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  No audiences yet. Create one with the prompt builder!
                </div>
              ) : (
                dbAudiences.map((aud) => {
                  const isSelected = aud.id === selectedAudienceId
                  return (
                    <button
                      key={aud.id}
                      type="button"
                      onClick={() => setSelectedAudienceId(aud.id)}
                      className={`w-full text-left p-2.5 rounded-lg transition-all border ${
                        isSelected
                          ? 'bg-blue-50/50 dark:bg-blue-950/30 border-[#2445C8] shadow-2xs'
                          : 'border-transparent hover:bg-slate-50 dark:hover:bg-muted/30 hover:border-slate-200/60'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs sm:text-sm text-slate-900 dark:text-white truncate">
                          {aud.name}
                        </span>
                        {aud.is_archived && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                            Archived
                          </Badge>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 dark:text-slate-400 mt-0.5">
                        {aud.people_count} prospects · {aud.refresh_schedule}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </Card>
        </div>

        {/* ---------------- RIGHT COLUMN: PROMPT & MATCHES ---------------- */}
        <div className="lg:col-span-9 space-y-2">
          {/* Card 1: Describe Target Audience & AI Filter Pills */}
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0">
            {/* Header with Sparkle and Refresh */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#2445C8] fill-[#2445C8]" />
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeAudience?.name || 'Target Audience'}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] sm:text-xs text-slate-400">
                  {activeAudience?.last_refreshed_at
                    ? `Refreshed ${new Date(activeAudience.last_refreshed_at).toLocaleDateString()}`
                    : 'Auto-refresh active'}
                </span>
                {selectedAudienceId && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleRefreshAudience}
                      title="Refresh matches"
                      className="h-7 w-7"
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleDuplicate}
                      title="Duplicate audience"
                      className="h-7 w-7"
                    >
                      <Copy className="h-3.5 w-3.5 text-slate-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleArchive}
                      title="Archive audience"
                      className="h-7 w-7"
                    >
                      <Archive className="h-3.5 w-3.5 text-slate-500" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleDelete}
                      title="Delete audience"
                      className="h-7 w-7 text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Prompt Input (FR-2.1) */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                  DESCRIBE YOUR TARGET AUDIENCE (FR-2.1)
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={handleGenerateFilters}
                  disabled={isParsingPrompt}
                  className="text-xs text-[#2445C8] hover:text-[#1d38a8] font-semibold h-6 px-2"
                >
                  {isParsingPrompt ? (
                    <>
                      <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-[#2445C8] border-t-transparent mr-1" />
                      Parsing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mr-1" />
                      Re-generate filters
                    </>
                  )}
                </Button>
              </div>
              <Textarea
                rows={3}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="e.g. Founders and CTOs of B2B SaaS companies in India with 20–200 employees, who post about AI..."
                className="w-full text-xs sm:text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-muted/20 border-slate-200 dark:border-border rounded-lg p-3 focus-visible:ring-1 focus-visible:ring-[#2445C8] resize-none leading-relaxed"
              />
            </div>

            {/* Structured Filters (FR-2.2 & FR-2.3) */}
            <div className="mt-3.5 space-y-2">
              <div className="text-[10px] sm:text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                STRUCTURED FILTER CHIPS — CLICK TO EDIT OR REMOVE
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {activeFilters.map((filter, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className="h-auto py-1 px-2.5 rounded-lg border border-slate-200/80 dark:border-border text-xs text-slate-700 dark:text-slate-200 font-normal hover:bg-slate-200/60 dark:hover:bg-muted/80 transition-colors gap-1"
                  >
                    <span className="font-normal text-slate-500 dark:text-slate-400">
                      {filter.key}:
                    </span>
                    <span className="font-semibold text-slate-800 dark:text-white">
                      {filter.value}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveFilter(index)}
                      className="ml-0.5 opacity-50 hover:opacity-100 hover:text-red-600 transition-opacity cursor-pointer"
                      title="Remove filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => setIsAddFilterOpen(true)}
                  className="border-dashed border-slate-300 dark:border-border text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 h-6 px-2.5 rounded-lg"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  <span>Add filter</span>
                </Button>
              </div>
            </div>

            {/* Exclusion Toggles (FR-2.6) */}
            <div className="mt-3 flex flex-wrap items-center gap-4 pt-2 border-t border-slate-100 dark:border-border/60 text-xs text-slate-600 dark:text-slate-300">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={excludeConnections}
                  onCheckedChange={(checked) => setExcludeConnections(Boolean(checked))}
                />
                <span>Exclude 1st-degree connections</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox
                  checked={excludeActiveCampaigns}
                  onCheckedChange={(checked) => setExcludeActiveCampaigns(Boolean(checked))}
                />
                <span>Exclude prospects in active campaigns</span>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="mt-4 flex items-center gap-2">
              <Button
                type="button"
                onClick={handleFindPeople}
                disabled={isSearching}
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold px-4 h-8 rounded-lg shadow-2xs"
              >
                {isSearching ? (
                  <>
                    <span className="inline-block size-3 animate-spin rounded-full border-2 border-white border-t-transparent mr-1.5" />
                    <span>Scanning profiles...</span>
                  </>
                ) : (
                  <span>Find people</span>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleSaveAudience}
                className="text-xs font-semibold text-slate-700 dark:text-slate-200 h-8 px-4 rounded-lg shadow-2xs"
              >
                Save audience
              </Button>
            </div>
          </Card>

          {/* Card 2: Matches Table (FR-2.4 & FR-2.5) */}
          <Card className="rounded-xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0">
            {/* Matches Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {matches.length} matches
                </h2>
                <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
                  Sorted by fit score (0–100) · Discovered via LinkedIn session
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium mr-1">
                  {selectedCandidateIds.length} selected
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleExcludeSelected}
                  disabled={selectedCandidateIds.length === 0}
                  className="text-xs font-semibold h-8 px-3 rounded-lg shadow-2xs disabled:opacity-40"
                >
                  Exclude selected
                </Button>
                <Button
                  type="button"
                  onClick={() => setIsAssignCampaignOpen(true)}
                  disabled={selectedCandidateIds.length === 0}
                  className="bg-[#2445C8] hover:bg-[#1d38a8] text-white text-xs font-semibold h-8 px-3.5 rounded-lg shadow-2xs disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5 mr-1" />
                  <span>Add to campaign</span>
                </Button>
              </div>
            </div>

            {/* Matches Table */}
            <Table>
              <TableHeader>
                <TableRow className="border-b border-slate-100 dark:border-border/60 hover:bg-transparent">
                  <TableHead className="w-8 py-2.5 px-2">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={(checked) => toggleSelectAll(Boolean(checked))}
                      aria-label="Select all prospects"
                    />
                  </TableHead>
                  <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    PERSON
                  </TableHead>
                  <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    COMPANY
                  </TableHead>
                  <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
                    FIT
                  </TableHead>
                  <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    WHY THEY MATCH
                  </TableHead>
                  <TableHead className="py-2.5 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-right">
                    ACTIVITY
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-xs text-slate-400">
                      No matching prospects found. Click "Find people" or adjust your filter chips.
                    </TableCell>
                  </TableRow>
                ) : (
                  matches.map((candidate) => {
                    const isChecked = selectedCandidateIds.includes(candidate.id)
                    return (
                      <TableRow
                        key={candidate.id}
                        className="border-b border-slate-100 dark:border-border/40 hover:bg-slate-50/70 dark:hover:bg-muted/20 transition-colors"
                      >
                        <TableCell className="py-3 px-2">
                          <Checkbox
                            checked={isChecked}
                            onCheckedChange={(checked) =>
                              toggleCandidate(candidate.id, Boolean(checked))
                            }
                            aria-label={`Select ${candidate.name}`}
                          />
                        </TableCell>
                        <TableCell className="py-3 px-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-full ${candidate.avatar_color} text-white font-bold text-xs flex items-center justify-center shrink-0 shadow-2xs`}
                            >
                              {candidate.initials}
                            </div>
                            <div>
                              <span className="font-semibold text-xs text-slate-900 dark:text-white block hover:text-blue-600 cursor-pointer">
                                {candidate.name}
                              </span>
                              <span className="text-[11px] text-slate-400 block truncate max-w-[200px]">
                                {candidate.title}
                              </span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-xs text-slate-700 dark:text-slate-300 font-medium">
                          {candidate.company}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-center">
                          <Badge
                            variant="outline"
                            className={`font-bold text-xs px-2 py-0.5 rounded-md border ${
                              candidate.fit_score >= 85
                                ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                                : 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400'
                            }`}
                          >
                            {candidate.fit_score}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-3 px-3 text-xs text-slate-600 dark:text-slate-300 max-w-xs truncate">
                          {candidate.why_match}
                        </TableCell>
                        <TableCell className="py-3 px-3 text-right text-xs text-slate-400 whitespace-nowrap">
                          {candidate.last_post || 'Recently active'}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>

            {/* Pagination Footer */}
            <div className="flex items-center justify-between pt-4 mt-1 border-t border-slate-100 dark:border-border/60 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                Showing {matches.length} matching prospects
              </span>
            </div>
          </Card>
        </div>
      </div>

      {/* ================= NEW AUDIENCE DIALOG (FR-2.8) ================= */}
      <Dialog open={isNewAudienceOpen} onOpenChange={setIsNewAudienceOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create new audience</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateAudience} className="space-y-3.5 mt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Audience Name
              </label>
              <Input
                required
                placeholder="e.g. AI Engineers in Bay Area"
                value={newAudienceName}
                onChange={(e) => setNewAudienceName(e.target.value)}
                className="w-full text-xs sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Target Audience Prompt
              </label>
              <Textarea
                rows={3}
                placeholder="Describe titles, industries, company stages, activity requirements..."
                value={newAudiencePrompt}
                onChange={(e) => setNewAudiencePrompt(e.target.value)}
                className="w-full text-xs sm:text-sm resize-none"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsNewAudienceOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white"
              >
                Create audience
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= ADD FILTER DIALOG (FR-2.3) ================= */}
      <Dialog open={isAddFilterOpen} onOpenChange={setIsAddFilterOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Filter Chip</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddFilter} className="space-y-3 mt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Filter Key
              </label>
              <Input
                required
                placeholder="e.g. Seniority, Tech stack, Location"
                value={newFilterKey}
                onChange={(e) => setNewFilterKey(e.target.value)}
                className="w-full text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Filter Value
              </label>
              <Input
                required
                placeholder="e.g. Director+, React, Bangalore"
                value={newFilterValue}
                onChange={(e) => setNewFilterValue(e.target.value)}
                className="w-full text-xs"
              />
            </div>

            <DialogFooter className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddFilterOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white"
              >
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ================= ASSIGN TO CAMPAIGN DIALOG (FR-2.7) ================= */}
      <Dialog open={isAssignCampaignOpen} onOpenChange={setIsAssignCampaignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add to Campaign</DialogTitle>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Select the active campaign to enroll {selectedCandidateIds.length} candidate(s) into:
            </p>

            <select
              value={targetCampaignId ?? ''}
              onChange={(e) => setTargetCampaignId(Number(e.target.value))}
              className="w-full text-xs sm:text-sm border border-slate-200 dark:border-border rounded-lg p-2.5 bg-white dark:bg-card"
            >
              <option value="">Select a campaign...</option>
              {liveCampaignsData?.items?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAssignCampaignOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={!targetCampaignId}
                onClick={handleAssignToCampaign}
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white"
              >
                Confirm enrollment
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ================= CSV IMPORT DIALOG (FR-2.10) ================= */}
      <Dialog open={isCsvImportOpen} onOpenChange={setIsCsvImportOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Import Prospects via CSV</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleImportCsv} className="space-y-3 mt-2">
            <p className="text-xs text-slate-500">
              Paste CSV text containing LinkedIn profile URLs (e.g. Full Name, Title, Company, URL):
            </p>

            <Textarea
              rows={5}
              required
              placeholder="Name,Title,Company,Profile URL&#10;Alice Smith,VP Eng,Acme,https://linkedin.com/in/alice-smith"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              className="w-full text-xs font-mono resize-none"
            />

            <DialogFooter className="pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCsvImportOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                className="bg-[#2445C8] hover:bg-[#1d38a8] text-white"
              >
                Import profiles
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
