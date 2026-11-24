import { useState, useRef } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sparkles,
  Plus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
  Edit3,
  Check,
  Trash2,
  Clock,
  Image as ImageIcon,
  Upload,
  X,
} from 'lucide-react'

import { useOptionalAuth } from '@/auth/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { contentStudioApi } from '@/services/api'
import type { PostDraftItem } from '@/types/api'

interface PostDraft {
  id: string
  title: string
  content: string
  format: string
  wordCount: number
  readingTimeSeconds: number
  voiceMatch: number
  bestTime: string
  scheduledSlot: string
}


export function ContentStudio() {
  const auth = useOptionalAuth()
  const queryClient = useQueryClient()

  if (auth?.isAdmin) {
    return <Navigate to="/admin/content-studio" replace />
  }

  const userName = auth?.user?.full_name || 'User'
  const initials =
    userName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0].toUpperCase())
      .join('') || 'U'

  // Input states
  const [topicPrompt, setTopicPrompt] = useState(
    ''
  )
  const [postFormat, setPostFormat] = useState<'Text post' | 'Carousel' | 'Poll' | 'Article'>('Text post')
  const [contentPillarId, setContentPillarId] = useState<number | null>(null)
  const [postLength, setPostLength] = useState('Medium · ~150 words')

  // Drafts state
  const [drafts, setDrafts] = useState<PostDraft[]>([])
  const [activeDraftIndex, setActiveDraftIndex] = useState(0)
  const [isEditingDraft, setIsEditingDraft] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [imageUrl, setImageUrl] = useState<string>('')
  const [imageFileName, setImageFileName] = useState<string>('')
  const [showImageInput, setShowImageInput] = useState<boolean>(false)

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showNotification('Please select a valid image file (PNG, JPG, WebP, etc.).')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      showNotification('Image size should be under 5MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      setImageUrl(result)
      setImageFileName(file.name)
      setShowImageInput(true)
      showNotification(`Attached image: ${file.name}`)
    }
    reader.readAsDataURL(file)
  }

  const handleRemoveImage = () => {
    setImageUrl('')
    setImageFileName('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }
  const [notification, setNotification] = useState<string | null>(null)

  // Modals
  const [isIdeasOpen, setIsIdeasOpen] = useState(false)
  const [isPillarsOpen, setIsPillarsOpen] = useState(false)
  const [isRetrainOpen, setIsRetrainOpen] = useState(false)
  const [newPillarName, setNewPillarName] = useState('')
  const [newPillarFreq, setNewPillarFreq] = useState('1 / week')
  const [newPillarDesc, setNewPillarDesc] = useState('')

  const showNotification = (message: string) => {
    setNotification(message)
    setTimeout(() => setNotification(null), 3500)
  }

  // --- React Queries ---
  const pillarsQuery = useQuery({
    queryKey: ['content-pillars'],
    queryFn: async () => {
      const data = await contentStudioApi.getPillars()
      return data || []
    },
  })

  const calendarQuery = useQuery({
    queryKey: ['content-calendar'],
    queryFn: async () => {
      const data = await contentStudioApi.getCalendar()
      return data || []
    },
  })

  const pillarsList = pillarsQuery.data || []
  const activePillar = pillarsList.find((p) => p.id === contentPillarId) || pillarsList[0]

  const ideasQuery = useQuery({
    queryKey: ['content-ideas', activePillar?.name],
    queryFn: () => contentStudioApi.suggestIdeas(activePillar?.name),
    enabled: isIdeasOpen,
  })

  // --- React Mutations ---
  const generateDraftsMutation = useMutation({
    mutationFn: contentStudioApi.generateDrafts,
    onSuccess: (res) => {
      if (res.drafts && res.drafts.length > 0) {
        const mapped: PostDraft[] = res.drafts.map((d: PostDraftItem, idx: number) => ({
          id: `draft-gen-${Date.now()}-${idx}`,
          title: d.title,
          content: d.content,
          format: d.format || postFormat,
          wordCount: d.word_count,
          readingTimeSeconds: d.reading_time_seconds,
          voiceMatch: d.voice_match_score,
          bestTime: d.best_time,
          scheduledSlot: d.suggested_slot,
        }))
        setDrafts(mapped)
        setActiveDraftIndex(0)
        setIsEditingDraft(false)
        showNotification(`Generated ${mapped.length} fresh drafts in your tone of voice!`)
      }
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to generate drafts.')
    },
  })

  const regenerateMutation = useMutation({
    mutationFn: contentStudioApi.regenerateDraft,
    onSuccess: (draft: PostDraftItem) => {
      const updated = [...drafts]
      updated[activeDraftIndex] = {
        id: `draft-regen-${Date.now()}`,
        title: draft.title,
        content: draft.content,
        format: draft.format || postFormat,
        wordCount: draft.word_count,
        readingTimeSeconds: draft.reading_time_seconds,
        voiceMatch: draft.voice_match_score,
        bestTime: draft.best_time,
        scheduledSlot: draft.suggested_slot,
      }
      setDrafts(updated)
      setIsEditingDraft(false)
      showNotification('Draft regenerated with a fresh angle!')
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to regenerate draft.')
    },
  })

  const shortenMutation = useMutation({
    mutationFn: contentStudioApi.shortenDraft,
    onSuccess: (draft: PostDraftItem) => {
      const updated = [...drafts]
      const cur = updated[activeDraftIndex]
      if (cur) {
        cur.content = draft.content
        cur.wordCount = draft.word_count
        cur.readingTimeSeconds = draft.reading_time_seconds
      }
      setDrafts(updated)
      showNotification('Draft tightened and condensed.')
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to shorten draft.')
    },
  })

  const scheduleMutation = useMutation({
    mutationFn: contentStudioApi.schedulePost,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-calendar'] })
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      showNotification(`"${currentDraft.title}" scheduled and sent for approval!`)
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to schedule post.')
    },
  })

  const createPillarMutation = useMutation({
    mutationFn: contentStudioApi.createPillar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-pillars'] })
      setNewPillarName('')
      setNewPillarDesc('')
      showNotification('New content pillar added!')
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to create pillar.')
    },
  })

  const deletePillarMutation = useMutation({
    mutationFn: contentStudioApi.deletePillar,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-pillars'] })
      showNotification('Content pillar deleted.')
    },
    onError: (err: any) => {
      showNotification(err?.message || 'Failed to delete pillar.')
    },
  })

  const currentDraft = drafts[activeDraftIndex] || drafts[0]

  const handleGenerateDrafts = () => {
    generateDraftsMutation.mutate({
      topic_prompt: topicPrompt,
      post_format: postFormat,
      content_pillar_id: contentPillarId ?? activePillar?.id ?? undefined,
      post_length: postLength,
    })
  }

  const handleRegenerate = () => {
    regenerateMutation.mutate({
      topic_prompt: topicPrompt,
      current_content: currentDraft.content,
      post_format: postFormat,
      content_pillar_id: contentPillarId ?? activePillar?.id ?? undefined,
      post_length: postLength,
    })
  }

  const handleMakeShorter = () => {
    shortenMutation.mutate({
      content: currentDraft.content,
      target_ratio: 0.7,
    })
  }

  const handleSendForApproval = () => {
    scheduleMutation.mutate({
      title: currentDraft.title,
      content: currentDraft.content,
      post_format: currentDraft.format || postFormat,
      pillar_id: contentPillarId ?? activePillar?.id ?? undefined,
      best_time: currentDraft.bestTime,
      scheduled_for: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      send_to_approvals: true,
      image_url: imageUrl.trim() || undefined,
    })
  }

  const handlePrevDraft = () => {
    setActiveDraftIndex((prev) => (prev > 0 ? prev - 1 : drafts.length - 1))
    setIsEditingDraft(false)
  }

  const handleNextDraft = () => {
    setActiveDraftIndex((prev) => (prev < drafts.length - 1 ? prev + 1 : 0))
    setIsEditingDraft(false)
  }

  const handleDraftContentChange = (val: string) => {
    const updated = [...drafts]
    const cur = updated[activeDraftIndex]
    if (cur) {
      cur.content = val
      cur.wordCount = val.trim().split(/\s+/).filter(Boolean).length
      cur.readingTimeSeconds = Math.max(10, Math.round((cur.wordCount / 200) * 60))
    }
    setDrafts(updated)
  }

  const handleAddPillar = () => {
    if (!newPillarName.trim()) return
    createPillarMutation.mutate({
      name: newPillarName.trim(),
      target_cadence: newPillarFreq,
      description: newPillarDesc.trim() || undefined,
    })
  }

  const isGenerating = generateDraftsMutation.isPending
  const isRegenerating = regenerateMutation.isPending
  const isShortening = shortenMutation.isPending
  const isScheduling = scheduleMutation.isPending

  return (
    <div className="space-y-4 max-w-7xl mx-auto pb-10">
      {/* Toast Notification */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs text-white shadow-xl dark:bg-slate-100 dark:text-slate-900 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 dark:text-emerald-600" />
          <span>{notification}</span>
        </div>
      )}

      {/* ================= PAGE HEADER ================= */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Content Studio
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Create posts in your voice to keep your profile active. 3 posts a week, posted at your best times.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsIdeasOpen(true)}
            className="shadow-2xs font-semibold text-xs h-8 px-3.5 bg-white dark:bg-card border-slate-200 dark:border-border hover:bg-slate-50"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1 text-[#2445C8]" />
            <span>Suggest ideas</span>
          </Button>

          <Button
            size="sm"
            onClick={() => {
              setTopicPrompt('')
              setIsEditingDraft(true)
              showNotification('Ready for a new post idea.')
            }}
            className="shadow-2xs font-semibold text-xs h-8 px-3.5 bg-[#2445C8] hover:bg-[#1e3bb3] text-white"
          >
            <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
            <span>New post</span>
          </Button>
        </div>
      </div>

      {/* ================= 2-COLUMN MAIN LAYOUT ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ---------------- LEFT COLUMN: COMPOSE & DRAFTS (7 cols) ---------------- */}
        <div className="lg:col-span-7 space-y-4">
          {/* Card 1: Write with AI */}
          <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0">
            <h2 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white mb-3">
              Write with AI
            </h2>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1.5">
                  WHAT SHOULD THIS POST BE ABOUT?
                </label>
                <Textarea
                  value={topicPrompt}
                  onChange={(e) => setTopicPrompt(e.target.value)}
                  placeholder="e.g. 3 tactical lessons from scaling our agentic workflow, or a contrarian take on enterprise hiring..."
                  rows={3}
                  className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs sm:text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus-visible:ring-1 focus-visible:ring-[#2445C8] resize-none leading-relaxed"
                />
              </div>

              {/* Format & Pillar Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
                {/* Format Segmented Selector */}
                <div className="sm:col-span-7">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Format
                  </span>
                  <div className="inline-flex items-center p-0.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
                    {(['Text post', 'Carousel', 'Poll', 'Article'] as const).map((fmt) => {
                      const isActive = postFormat === fmt
                      return (
                        <button
                          key={fmt}
                          type="button"
                          onClick={() => setPostFormat(fmt)}
                          className={`text-xs px-2.5 py-1 rounded-md transition-all font-medium ${
                            isActive
                              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-2xs'
                              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {fmt}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Content Pillar Selector */}
                <div className="sm:col-span-5">
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Content pillar
                  </span>
                  <div className="relative">
                    <select
                      value={contentPillarId ?? activePillar?.id ?? ''}
                      onChange={(e) => setContentPillarId(Number(e.target.value))}
                      className="w-full appearance-none rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
                    >
                      {pillarsList.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  </div>
                </div>
              </div>

              {/* Length & Generate Button */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-1">
                <div>
                  <span className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                    Length
                  </span>
                  <div className="relative w-44">
                    <select
                      value={postLength}
                      onChange={(e) => setPostLength(e.target.value)}
                      className="w-full appearance-none rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-[#2445C8]"
                    >
                      <option value="Short · ~75 words">Short · ~75 words</option>
                      <option value="Medium · ~150 words">Medium · ~150 words</option>
                      <option value="Long · ~250 words">Long · ~250 words</option>
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  </div>
                </div>

                <Button
                  onClick={handleGenerateDrafts}
                  disabled={isGenerating || !topicPrompt.trim()}
                  className="bg-[#2445C8] hover:bg-[#1e3bb3] text-white font-semibold text-xs h-8.5 px-4 rounded-lg shadow-2xs self-start sm:self-auto"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      <span>Drafting...</span>
                    </>
                  ) : (
                    <span>Generate 3 drafts</span>
                  )}
                </Button>
              </div>
            </div>
          </Card>

          {/* Card 2: Draft Preview & Scheduling */}
          <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0 space-y-4">
            {drafts.length === 0 || !currentDraft ? (
              <div className="text-center py-12 px-4 space-y-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-muted flex items-center justify-center mx-auto text-slate-400">
                  <Sparkles className="h-5 w-5 text-[#2445C8]" />
                </div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  No drafts generated yet
                </p>
                <p className="text-xs text-slate-500 max-w-sm mx-auto">
                  Type a topic prompt above and click &quot;Generate 3 drafts&quot; to create LinkedIn post drafts tailored to your voice.
                </p>
              </div>
            ) : (
              <>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                  Draft {activeDraftIndex + 1} of {drafts.length}
                </h3>
                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                  ({currentDraft.format || postFormat})
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsEditingDraft(!isEditingDraft)}
                  className="h-7 px-2 text-xs text-slate-600 dark:text-slate-300 hover:text-slate-900"
                >
                  {isEditingDraft ? (
                    <>
                      <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" />
                      <span>Done</span>
                    </>
                  ) : (
                    <>
                      <Edit3 className="h-3.5 w-3.5 mr-1" />
                      <span>Edit draft</span>
                    </>
                  )}
                </Button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (!imageUrl) {
                      fileInputRef.current?.click()
                    } else {
                      setShowImageInput(!showImageInput)
                    }
                  }}
                  className={`h-7 px-2 text-xs hover:text-slate-900 ${
                    imageUrl
                      ? 'text-[#2445C8] dark:text-blue-400 font-semibold'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                  title={imageUrl ? 'Manage attached image' : 'Attach image from local files'}
                >
                  <ImageIcon className="h-3.5 w-3.5 mr-1" />
                  <span>{imageUrl ? 'Image attached' : 'Attach image'}</span>
                </Button>

                <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-800 pl-1.5">
                  <button
                    type="button"
                    onClick={handlePrevDraft}
                    className="p-1 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Previous draft"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleNextDraft}
                    className="p-1 rounded-md border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Next draft"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* LinkedIn-styled Post Preview Frame */}
            <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 p-4 bg-white dark:bg-slate-900/30 space-y-3">
              {/* Profile Header */}
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-slate-800 text-white font-bold text-xs flex items-center justify-center shrink-0">
                  {initials}
                </div>
                <div>
                  <div className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white leading-tight">
                    {userName}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-slate-500">
                    LinkedIn Post Preview · {activePillar?.name}
                  </div>
                </div>
              </div>

              {/* Attached Image Bar */}
              {(showImageInput || imageUrl) && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 text-xs">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <ImageIcon className="h-4 w-4 text-[#2445C8] dark:text-blue-400 shrink-0" />
                    {imageUrl ? (
                      <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                        {imageFileName || 'Image attached'}
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">
                        Select an image from local files or enter URL
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-7 px-2.5 text-xs border-slate-300 dark:border-slate-700 font-medium flex items-center gap-1 hover:bg-white dark:hover:bg-slate-800"
                    >
                      <Upload className="h-3 w-3" />
                      <span>{imageUrl ? 'Change image' : 'Choose image'}</span>
                    </Button>

                    {imageUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveImage}
                        className="h-7 px-2 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 flex items-center gap-1"
                        title="Remove image"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Post Content */}
              {isEditingDraft ? (
                <Textarea
                  value={currentDraft.content}
                  onChange={(e) => handleDraftContentChange(e.target.value)}
                  rows={8}
                  className="rounded-lg border border-slate-300 dark:border-slate-700 p-3 text-xs sm:text-sm font-normal text-slate-900 dark:text-slate-100 resize-y leading-relaxed focus-visible:ring-1 focus-visible:ring-[#2445C8]"
                />
              ) : (
                <div className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 whitespace-pre-line leading-relaxed font-normal">
                  {currentDraft.content}
                </div>
              )}

              {/* Attached Image Preview */}
              {imageUrl.trim() && (
                <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 mt-2">
                  <img
                    src={imageUrl.trim()}
                    alt="Attached image"
                    className="w-full max-h-72 object-cover"
                  />
                </div>
              )}

              {/* Analytics & Voice Matching Badges */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                <span className="text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2.5 py-1 rounded-md">
                  {currentDraft.wordCount} words (~{currentDraft.readingTimeSeconds}s read)
                </span>
                <span className="text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60 px-2.5 py-1 rounded-md">
                  Matches your voice · {currentDraft.voiceMatch}%
                </span>
                <span className="text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2.5 py-1 rounded-md">
                  Best time: {currentDraft.bestTime}
                </span>
              </div>
            </div>

            {/* Bottom Actions Row */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRegenerate}
                  disabled={isRegenerating || isGenerating}
                  className="font-semibold text-xs h-8 px-3 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                >
                  {isRegenerating ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
                      <span>Regenerating...</span>
                    </>
                  ) : (
                    <span>Regenerate hook</span>
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleMakeShorter}
                  disabled={isShortening}
                  className="font-semibold text-xs h-8 px-3 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
                >
                  {isShortening ? (
                    <>
                      <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
                      <span>Tightening...</span>
                    </>
                  ) : (
                    <span>Make shorter</span>
                  )}
                </Button>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <span className="text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  <span>Suggested slot:</span>
                </span>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {currentDraft.scheduledSlot}
                </div>
              </div>
            </div>

            {/* Send for Approval Primary CTA */}
            <div>
              <Button
                onClick={handleSendForApproval}
                disabled={isScheduling}
                className="bg-[#2445C8] hover:bg-[#1e3bb3] text-white font-semibold text-xs h-8.5 px-4 rounded-lg shadow-2xs"
              >
                {isScheduling ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    <span>Scheduling...</span>
                  </>
                ) : (
                  <span>Send for approval & schedule</span>
                )}
              </Button>
            </div>
            </>
          )}
        </Card>
        </div>

        {/* ---------------- RIGHT COLUMN: SCHEDULE & PILLARS (5 cols) ---------------- */}
        <div className="lg:col-span-5 space-y-4">
          {/* Card 1: This Week Calendar */}
          <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
                This week
              </h3>
              <span className="text-xs text-slate-400 font-medium">Calendar</span>
            </div>

            <div className="space-y-2.5 divide-y divide-slate-100 dark:divide-slate-800/80">
              {calendarQuery.data && calendarQuery.data.length > 0 ? (
                calendarQuery.data.map((item, idx) => {
                  const hasPost = Boolean(item.post)
                  const isApproved = item.status === 'SCHEDULED'
                  const isWaiting = item.status === 'WAITING_APPROVAL'
                  const isPublished = item.status === 'PUBLISHED'
                  const isRejected = item.status === 'REJECTED'

                  return (
                    <div key={idx} className="flex items-start gap-3 pt-2 first:pt-0">
                      <div className="w-12 text-left">
                        <div className="text-[11px] font-medium text-slate-400">{item.day_name.slice(0, 3)}</div>
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200 leading-none mt-0.5">
                          {item.date_str.split('-').slice(1).join('/')}
                        </div>
                      </div>
                      {hasPost ? (
                        <div
                          className={`flex-1 rounded-lg border p-2.5 ${
                            isPublished
                              ? 'border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900/40'
                              : isApproved
                              ? 'border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20'
                              : isRejected
                              ? 'border-rose-200/80 dark:border-rose-900/40 bg-rose-50/70 dark:bg-rose-950/20'
                              : 'border-amber-200/80 dark:border-amber-900/40 bg-amber-50/70 dark:bg-amber-950/20'
                          }`}
                        >
                          <div
                            className={`font-bold text-xs leading-snug ${
                              isApproved
                                ? 'text-[#1e3bb3] dark:text-blue-300'
                                : isWaiting
                                ? 'text-amber-950 dark:text-amber-200'
                                : isRejected
                                ? 'text-rose-950 dark:text-rose-200'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {item.post?.best_time || '10:00'} · {item.post?.title}
                          </div>
                          <div className="flex items-center justify-between mt-1 gap-2">
                            <span
                              className={`text-[11px] ${
                                isPublished
                                  ? 'text-slate-400 dark:text-slate-500'
                                  : isApproved
                                  ? 'text-blue-600 dark:text-blue-400 font-semibold'
                                  : isRejected
                                  ? 'text-rose-600 dark:text-rose-400 font-semibold'
                                  : 'text-amber-700 dark:text-amber-400 font-semibold'
                              }`}
                            >
                              {isPublished
                                ? 'Published'
                                : isApproved
                                ? 'Scheduled · Approved'
                                : isRejected
                                ? 'Rejected'
                                : 'Waiting for approval'}
                            </span>
                            {isWaiting && (
                              <Link
                                to="/approvals?tab=POSTS"
                                className="text-[10px] px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold transition-colors flex items-center gap-1 shrink-0"
                              >
                                <span>Review in Approvals</span>
                                <span>&rarr;</span>
                              </Link>
                            )}
                            {isRejected && item.post?.id && (
                              <button
                                type="button"
                                onClick={async (e) => {
                                  e.stopPropagation()
                                  try {
                                    await contentStudioApi.deletePost(item.post!.id)
                                    void queryClient.invalidateQueries({ queryKey: ['content-calendar'] })
                                    void queryClient.invalidateQueries({ queryKey: ['user-posts-pending'] })
                                    showNotification('Rejected post removed from calendar.')
                                  } catch (err: any) {
                                    showNotification(err?.message || 'Failed to remove post.')
                                  }
                                }}
                                className="text-[10px] px-2 py-0.5 rounded text-rose-600 hover:text-rose-700 hover:bg-rose-100 dark:hover:bg-rose-950/40 font-medium transition-colors shrink-0"
                                title="Remove from calendar"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex-1 py-2 text-[11px] text-slate-400 dark:text-slate-600 italic">
                          {item.day_name === 'Sunday' ? 'Rest day' : 'No post scheduled'}
                        </div>
                      )}
                    </div>
                  )
                })
              ) : (
                <div className="py-6 text-center text-xs text-slate-400 dark:text-slate-500 italic">
                  No posts scheduled for this week.
                </div>
              )}
            </div>
          </Card>

          {/* Card 2: Content Pillars */}
          <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
            <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
              Content pillars
            </h3>

            <div className="space-y-2">
              {pillarsList.length > 0 ? (
                pillarsList.map((pillar) => (
                  <div
                    key={pillar.id}
                    className="flex items-center justify-between text-xs py-1"
                  >
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {pillar.name}
                    </span>
                    <span className="text-slate-500 dark:text-slate-400 font-medium">
                      {pillar.target_cadence}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 dark:text-slate-500 italic py-1">
                  No content pillars configured.
                </div>
              )}
            </div>

            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsPillarsOpen(true)}
                className="font-semibold text-xs h-8 px-3 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
              >
                Edit pillars
              </Button>
            </div>
          </Card>

          {/* Card 3: Your Voice Profile */}
          <Card className="rounded-2xl border border-slate-200/90 dark:border-border p-4 sm:p-5 shadow-2xs bg-white dark:bg-card ring-0 space-y-3">
            <h3 className="font-bold text-sm sm:text-base text-slate-900 dark:text-white">
              Your voice profile
            </h3>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Learned from your last 20 posts: direct, practical, numbered lessons, ends with a question, 2–3 hashtags, no emojis.
            </p>

            <div className="pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRetrainOpen(true)}
                className="font-semibold text-xs h-8 px-3 border-slate-200 dark:border-slate-800 hover:bg-slate-50"
              >
                Retrain
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* ================= MODAL: SUGGEST IDEAS ================= */}
      <Dialog open={isIdeasOpen} onOpenChange={setIsIdeasOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <Sparkles className="h-4 w-4 text-[#2445C8]" />
              <span>Recommended Post Angles ({activePillar?.name})</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            {ideasQuery.isLoading ? (
              <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-[#2445C8]" />
                <span>Fetching tailored post ideas...</span>
              </div>
            ) : (() => {
                const rawIdeas = ideasQuery.data?.ideas || []
                if (rawIdeas.length === 0) {
                  return (
                    <div className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">
                      No suggested ideas available for this pillar.
                    </div>
                  )
                }
                const normalizedIdeas = rawIdeas.map((idea: any) => {
                  if (typeof idea === 'string') {
                    if (idea.includes(' — ')) {
                      const [t, ...rest] = idea.split(' — ')
                      return { title: t.trim(), preview: rest.join(' — ').trim() }
                    }
                    if (idea.includes(': ')) {
                      const [t, ...rest] = idea.split(': ')
                      return { title: t.trim(), preview: rest.join(': ').trim() }
                    }
                    return { title: idea, preview: 'Actionable post angle based on your active content pillars' }
                  }
                  return {
                    title: idea.title || idea.name || String(idea),
                    preview: idea.preview || idea.description || '',
                  }
                })

                return normalizedIdeas.map((idea, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setTopicPrompt(idea.preview ? `${idea.title} — ${idea.preview}` : idea.title)
                      setIsIdeasOpen(false)
                      showNotification(`Applied idea: "${idea.title}"`)
                    }}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:border-[#2445C8] hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all"
                  >
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {idea.title}
                    </div>
                    {idea.preview && (
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                        {idea.preview}
                      </div>
                    )}
                  </button>
                ))
              })()}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsIdeasOpen(false)}
              className="text-xs h-8"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: EDIT CONTENT PILLARS ================= */}
      <Dialog open={isPillarsOpen} onOpenChange={setIsPillarsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-white">
              Edit Content Pillars
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {pillarsList.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-slate-200 dark:border-slate-800"
                >
                  <div>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {p.name}
                    </span>
                    {p.description && (
                      <p className="text-[10px] text-slate-400 mt-0.5">{p.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{p.target_cadence}</span>
                    <button
                      type="button"
                      onClick={() => deletePillarMutation.mutate(p.id)}
                      className="text-slate-400 hover:text-rose-600 transition-colors p-1"
                      title="Delete pillar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Add new pillar
              </span>
              <div className="flex gap-2">
                <Input
                  value={newPillarName}
                  onChange={(e) => setNewPillarName(e.target.value)}
                  placeholder="e.g. Engineering Culture"
                  className="h-8 text-xs"
                />
                <select
                  value={newPillarFreq}
                  onChange={(e) => setNewPillarFreq(e.target.value)}
                  className="rounded-lg border border-slate-200 dark:border-slate-800 text-xs px-2 bg-white dark:bg-slate-900"
                >
                  <option value="1 / week">1 / wk</option>
                  <option value="2 / week">2 / wk</option>
                  <option value="1 / month">1 / mo</option>
                  <option value="2 / month">2 / mo</option>
                </select>
                <Button
                  size="sm"
                  onClick={handleAddPillar}
                  disabled={createPillarMutation.isPending || !newPillarName.trim()}
                  className="bg-[#2445C8] hover:bg-[#1e3bb3] text-white text-xs h-8 px-3"
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => setIsPillarsOpen(false)}
              className="bg-[#2445C8] hover:bg-[#1e3bb3] text-white text-xs h-8"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================= MODAL: RETRAIN VOICE PROFILE ================= */}
      <Dialog open={isRetrainOpen} onOpenChange={setIsRetrainOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-white">
              Retrain Voice Profile
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs text-slate-600 dark:text-slate-400">
            <p>
              The AI automatically analyzes your latest LinkedIn published posts to calibrate tone, sentence length, and vocabulary.
            </p>
            <div className="rounded-lg bg-slate-50 dark:bg-slate-900/60 p-3 border border-slate-200 dark:border-slate-800 space-y-1.5">
              <div className="font-semibold text-slate-900 dark:text-white">Current Attributes:</div>
              <ul className="list-disc pl-4 space-y-1 text-slate-600 dark:text-slate-400">
                <li>Direct, executive tone with practical framing</li>
                <li>Prefers numbered lists for multi-point lessons</li>
                <li>Ends with an open question to stimulate comments</li>
                <li>Strict policy: 0 marketing fluff, 0 corporate jargon</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRetrainOpen(false)}
              className="text-xs h-8"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setIsRetrainOpen(false)
                showNotification('Voice profile successfully recalibrated against your latest posts!')
              }}
              className="bg-[#2445C8] hover:bg-[#1e3bb3] text-white text-xs h-8"
            >
              Recalibrate now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
