import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { API_BASE } from '@/services/client'
import { getAccessToken } from '@/services/tokens'
import type { Activity } from '@/types/api'

/** Queries refreshed when a matching agent event arrives. */
const INVALIDATION_MAP: Record<string, string[][]> = {
  candidate_discovered: [['dashboard'], ['candidates']],
  candidate_evaluated: [['dashboard'], ['candidates']],
  post_found: [['posts'], ['candidates']],
  post_evaluated: [['posts'], ['dashboard']],
  action_started: [['dashboard']],
  action_completed: [['dashboard'], ['posts'], ['analytics']],
  comment_generated: [['approvals'], ['dashboard']],
  approval_required: [['approvals'], ['approvals', 'counts'], ['dashboard']],
  connection_scheduled: [['scheduled-actions'], ['dashboard']],
  connection_ready: [['approvals'], ['approvals', 'counts']],
  workflow_completed: [['dashboard'], ['candidates'], ['analytics']],
  workflow_failed: [['dashboard'], ['activity']],
  workflow_state_changed: [['candidates']],
  campaign_status_changed: [['campaigns'], ['dashboard']],
}

export interface ActivityStreamState {
  events: Activity[]
  connected: boolean
}

/**
 * Subscribes to the backend's SSE feed.
 *
 * The connection is the source of truth for "something changed"; the affected
 * React Query caches are invalidated so every open page stays current without
 * polling each endpoint separately.
 */
export function useActivityStream(
  options: { campaignId?: number; bufferSize?: number; enabled?: boolean } = {},
): ActivityStreamState {
  const { campaignId, bufferSize = 100, enabled = true } = options
  const queryClient = useQueryClient()
  const [events, setEvents] = useState<Activity[]>([])
  const [connected, setConnected] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return

    // EventSource cannot set an Authorization header, so the stream endpoint
    // accepts the access token as a query parameter instead.
    const token = getAccessToken()
    if (!token) return

    const params = new URLSearchParams({ token })
    if (campaignId !== undefined) params.set('campaign_id', String(campaignId))

    const source = new EventSource(`${API_BASE}/activity/stream?${params.toString()}`)
    sourceRef.current = source

    source.onopen = () => setConnected(true)
    source.onerror = () => setConnected(false)

    const handle = (event: MessageEvent<string>) => {
      let activity: Activity
      try {
        activity = JSON.parse(event.data) as Activity
      } catch {
        return
      }

      setEvents((previous) => [activity, ...previous].slice(0, bufferSize))

      for (const key of INVALIDATION_MAP[activity.event_type] ?? [['dashboard']]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    }

    for (const eventType of Object.keys(INVALIDATION_MAP)) {
      source.addEventListener(eventType, handle as EventListener)
    }
    source.addEventListener('agent_log', handle as EventListener)
    source.onmessage = handle

    return () => {
      source.close()
      sourceRef.current = null
      setConnected(false)
    }
  }, [campaignId, bufferSize, enabled, queryClient])

  return { events, connected }
}
