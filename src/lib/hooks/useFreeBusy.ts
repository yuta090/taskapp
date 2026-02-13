'use client'

import { useState, useCallback, useRef } from 'react'

interface FreeBusySlots {
  /** userId -> slotKey -> isBusy */
  [userId: string]: Record<string, boolean>
}

interface UseFreeBusyReturn {
  busySlots: FreeBusySlots
  loading: boolean
  error: Error | null
  fetchFreeBusy: (
    userIds: string[],
    timeRanges: { start: string; end: string }[]
  ) => Promise<void>
}

/**
 * Hook to fetch Free/Busy information from Google Calendar for connected users.
 * Returns a mapping of userId -> slotKey -> isBusy.
 *
 * slotKey is formatted as "{start}_{end}" to uniquely identify each time range.
 */
export function useFreeBusy(): UseFreeBusyReturn {
  const [busySlots, setBusySlots] = useState<FreeBusySlots>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const fetchIdRef = useRef(0)

  const fetchFreeBusy = useCallback(
    async (
      userIds: string[],
      timeRanges: { start: string; end: string }[]
    ) => {
      if (userIds.length === 0 || timeRanges.length === 0) {
        setBusySlots({})
        return
      }

      const fetchId = ++fetchIdRef.current
      setLoading(true)
      setError(null)

      try {
        const allStarts = timeRanges.map((r) => new Date(r.start).getTime())
        const allEnds = timeRanges.map((r) => new Date(r.end).getTime())
        const timeMin = new Date(Math.min(...allStarts)).toISOString()
        const timeMax = new Date(Math.max(...allEnds)).toISOString()

        const res = await fetch('/api/integrations/freebusy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds, timeMin, timeMax }),
        })

        if (!res.ok) {
          throw new Error('Free/Busy情報の取得に失敗しました')
        }

        const data = await res.json()

        if (fetchId !== fetchIdRef.current) return

        // Process response: map each user's busy periods to our slot time ranges
        const result: FreeBusySlots = {}

        for (const userId of userIds) {
          result[userId] = {}
          const userBusy: { start: string; end: string }[] =
            data.calendars?.[userId]?.busy ?? []

          for (const range of timeRanges) {
            const slotKey = `${range.start}_${range.end}`
            const slotStart = new Date(range.start).getTime()
            const slotEnd = new Date(range.end).getTime()

            // Check if any busy period overlaps with this slot
            const isBusy = userBusy.some((busy) => {
              const busyStart = new Date(busy.start).getTime()
              const busyEnd = new Date(busy.end).getTime()
              return busyStart < slotEnd && busyEnd > slotStart
            })

            result[userId][slotKey] = isBusy
          }
        }

        setBusySlots(result)
      } catch (err) {
        if (fetchId === fetchIdRef.current) {
          setError(err instanceof Error ? err : new Error('Unknown error'))
        }
      } finally {
        if (fetchId === fetchIdRef.current) {
          setLoading(false)
        }
      }
    },
    []
  )

  return { busySlots, loading, error, fetchFreeBusy }
}
