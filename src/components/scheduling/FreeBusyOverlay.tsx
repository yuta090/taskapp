'use client'

import { useEffect, useMemo } from 'react'
import { useFreeBusy } from '@/lib/hooks/useFreeBusy'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar/config'

interface Respondent {
  userId: string
  displayName: string
  /** Whether this user has a Google Calendar connection */
  isCalendarConnected?: boolean
}

interface SlotDraft {
  id: string
  startAt: string
}

interface FreeBusyOverlayProps {
  respondents: Respondent[]
  slots: SlotDraft[]
  durationMinutes: number
}

interface StatusDot {
  userId: string
  displayName: string
  status: 'free' | 'busy' | 'unknown'
}

/**
 * Shows Free/Busy status indicators next to each candidate slot
 * in the ProposalCreateSheet. Only renders when Google Calendar
 * integration is enabled.
 */
export function FreeBusyOverlay({
  respondents,
  slots,
  durationMinutes,
}: FreeBusyOverlayProps) {
  const isEnabled = isGoogleCalendarConfigured()
  const { busySlots, loading, fetchFreeBusy } = useFreeBusy()

  // Build time ranges from slots
  const timeRanges = useMemo(() => {
    return slots
      .filter((s) => s.startAt)
      .map((s) => {
        const start = new Date(s.startAt)
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
        return {
          start: start.toISOString(),
          end: end.toISOString(),
        }
      })
  }, [slots, durationMinutes])

  // User IDs of connected respondents
  const connectedUserIds = useMemo(() => {
    return respondents
      .filter((r) => r.isCalendarConnected)
      .map((r) => r.userId)
  }, [respondents])

  // Fetch free/busy when respondents or slots change
  useEffect(() => {
    if (!isEnabled || connectedUserIds.length === 0 || timeRanges.length === 0) return
    fetchFreeBusy(connectedUserIds, timeRanges)
  }, [isEnabled, connectedUserIds, timeRanges, fetchFreeBusy])

  if (!isEnabled || respondents.length === 0) return null

  // For each slot, compute status dots
  const getDotsForSlot = (slot: SlotDraft): StatusDot[] => {
    if (!slot.startAt) return []

    const start = new Date(slot.startAt)
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
    const slotKey = `${start.toISOString()}_${end.toISOString()}`

    return respondents.map((r) => {
      if (!r.isCalendarConnected) {
        return { userId: r.userId, displayName: r.displayName, status: 'unknown' as const }
      }

      const isBusy = busySlots[r.userId]?.[slotKey]
      return {
        userId: r.userId,
        displayName: r.displayName,
        status: isBusy ? ('busy' as const) : ('free' as const),
      }
    })
  }

  return (
    <div className="space-y-2" data-testid="freebusy-overlay">
      {slots.map((slot, idx) => {
        if (!slot.startAt) return null
        const dots = getDotsForSlot(slot)
        if (dots.length === 0) return null

        return (
          <div
            key={slot.id}
            className="flex items-center gap-1.5 flex-wrap"
            data-testid={`freebusy-slot-${idx}`}
          >
            {loading ? (
              <span className="text-2xs text-gray-400">確認中...</span>
            ) : (
              dots.map((dot) => (
                <span
                  key={dot.userId}
                  className="inline-flex items-center gap-1 text-2xs"
                  title={`${dot.displayName}: ${
                    dot.status === 'free'
                      ? '空き'
                      : dot.status === 'busy'
                        ? '埋まり'
                        : '未連携'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      dot.status === 'free'
                        ? 'bg-green-500'
                        : dot.status === 'busy'
                          ? 'bg-red-500'
                          : 'bg-gray-300'
                    }`}
                  />
                  <span
                    className={`${
                      dot.status === 'free'
                        ? 'text-green-700'
                        : dot.status === 'busy'
                          ? 'text-red-600'
                          : 'text-gray-400'
                    }`}
                  >
                    {dot.displayName}
                  </span>
                </span>
              ))
            )}
          </div>
        )
      })}
    </div>
  )
}
