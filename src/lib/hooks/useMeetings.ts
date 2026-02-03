'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import type { Meeting, MeetingParticipant } from '@/types/database'

interface UseMeetingsOptions {
  orgId: string
  spaceId: string
}

export interface CreateMeetingInput {
  title: string
  heldAt?: string | null
  /** クライアント参加者のユーザーID（AT-001: 1名以上必須） */
  clientParticipantIds: string[]
  /** 社内参加者のユーザーID */
  internalParticipantIds: string[]
}

interface ParseMinutesResult {
  createdCount: number
  createdTasks: Array<{
    taskId: string
    title: string
    specPath: string
    dueDate: string | null
    lineNumber: number
  }>
  updatedMinutes: string
}

interface MinutesPreviewResult {
  newSpecCount: number
  existingSpecCount: number
  newSpecs: Array<{
    lineNumber: number
    specPath: string
    title: string
  }>
  existingSpecs: Array<{
    lineNumber: number
    specPath: string
    title: string
    taskId: string
  }>
}

interface UseMeetingsReturn {
  meetings: Meeting[]
  participants: Record<string, MeetingParticipant[]>
  loading: boolean
  error: Error | null
  fetchMeetings: () => Promise<void>
  createMeeting: (meeting: CreateMeetingInput) => Promise<Meeting>
  startMeeting: (meetingId: string) => Promise<void>
  endMeeting: (meetingId: string) => Promise<{
    summary_subject: string
    summary_body: string
    counts: { decided: number; open: number; ball_client: number }
  }>
  /** AT-005: Parse meeting minutes and create SPEC tasks */
  parseMinutes: (meetingId: string, minutesMd: string) => Promise<ParseMinutesResult>
  /** AT-005: Preview minutes parsing without creating tasks */
  previewMinutes: (meetingId: string, minutesMd: string) => Promise<MinutesPreviewResult>
}

export function useMeetings({
  orgId,
  spaceId,
}: UseMeetingsOptions): UseMeetingsReturn {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [participants, setParticipants] = useState<
    Record<string, MeetingParticipant[]>
  >({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabase = createClient()

  const fetchMeetings = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Fetch meetings
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .order('held_at', { ascending: false })

      if (meetingsError) throw meetingsError
      const meetings = (meetingsData || []) as Meeting[]
      setMeetings(meetings)

      // Fetch participants for all meetings
      const meetingIds = meetings.map((m) => m.id)
      if (meetingIds.length > 0) {
        const { data: participantsData, error: participantsError } =
          await supabase
            .from('meeting_participants')
            .select('*')
            .in('meeting_id' as never, meetingIds as never)

        if (participantsError) throw participantsError

        // Group participants by meeting_id
        const participantsByMeeting: Record<string, MeetingParticipant[]> = {}
        const participants = (participantsData || []) as MeetingParticipant[]
        participants.forEach((p) => {
          if (!participantsByMeeting[p.meeting_id]) {
            participantsByMeeting[p.meeting_id] = []
          }
          participantsByMeeting[p.meeting_id].push(p)
        })
        setParticipants(participantsByMeeting)
      }
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch meetings')
      )
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  const createMeeting = useCallback(
    async (meeting: CreateMeetingInput) => {
      // AT-001: クライアント参加者が1名以上必須
      if (meeting.clientParticipantIds.length === 0) {
        const err = new Error('クライアント参加者を1名以上選択してください')
        setError(err)
        throw err
      }

      const now = new Date().toISOString()
      const heldAt = meeting.heldAt ?? now
      const tempId = crypto.randomUUID()
      const optimisticMeeting: Meeting = {
        id: tempId,
        org_id: orgId,
        space_id: spaceId,
        title: meeting.title,
        held_at: heldAt,
        notes: null,
        status: 'planned',
        started_at: null,
        ended_at: null,
        minutes_md: null,
        summary_subject: null,
        summary_body: null,
        created_at: now,
        updated_at: now,
      }

      setMeetings((prev) => [optimisticMeeting, ...prev])

      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser()
        if (authError) throw authError
        if (!authData?.user) {
          throw new Error('ログインが必要です')
        }

        const { data: created, error: createError } = await supabase
          .from('meetings')
          .insert(
            {
              org_id: orgId,
              space_id: spaceId,
              title: meeting.title,
              held_at: heldAt,
              status: 'planned',
              created_by: authData.user.id,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any
          )
          .select('*')
          .single()

        if (createError) throw createError

        const createdMeeting = created as Meeting

        // 参加者を登録
        const participantRows = [
          ...meeting.clientParticipantIds.map((userId) => ({
            meeting_id: createdMeeting.id,
            user_id: userId,
            side: 'client' as const,
            created_by: authData.user.id,
          })),
          ...meeting.internalParticipantIds.map((userId) => ({
            meeting_id: createdMeeting.id,
            user_id: userId,
            side: 'internal' as const,
            created_by: authData.user.id,
          })),
        ]

        if (participantRows.length > 0) {
          const { error: participantError } = await supabase
            .from('meeting_participants')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .insert(participantRows as any)
          if (participantError) throw participantError
        }

        setMeetings((prev) =>
          prev.map((m) => (m.id === tempId ? createdMeeting : m))
        )

        await fetchMeetings()
        return createdMeeting
      } catch (err) {
        setMeetings((prev) => prev.filter((m) => m.id !== tempId))
        setError(
          err instanceof Error ? err : new Error('Failed to create meeting')
        )
        throw err
      }
    },
    [orgId, spaceId, supabase, fetchMeetings]
  )

  const startMeeting = useCallback(
    async (meetingId: string) => {
      // Optimistic update
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === meetingId
            ? { ...m, status: 'in_progress' as const, started_at: new Date().toISOString() }
            : m
        )
      )

      try {
        await rpc.meetingStart(supabase, { meetingId })
        await fetchMeetings()
      } catch (err) {
        await fetchMeetings()
        throw err
      }
    },
    [supabase, fetchMeetings]
  )

  const endMeeting = useCallback(
    async (meetingId: string) => {
      // Optimistic update
      setMeetings((prev) =>
        prev.map((m) =>
          m.id === meetingId
            ? { ...m, status: 'ended' as const, ended_at: new Date().toISOString() }
            : m
        )
      )

      try {
        const result = await rpc.meetingEnd(supabase, { meetingId })
        await fetchMeetings()
        return {
          summary_subject: result.summary_subject,
          summary_body: result.summary_body,
          counts: result.counts,
        }
      } catch (err) {
        await fetchMeetings()
        throw err
      }
    },
    [supabase, fetchMeetings]
  )

  // AT-005: Parse meeting minutes and create SPEC tasks
  const parseMinutes = useCallback(
    async (meetingId: string, minutesMd: string): Promise<ParseMinutesResult> => {
      try {
        const result = await rpc.parseMeetingMinutes(supabase, {
          meetingId,
          minutesMd,
        })

        // Update local meeting with new minutes
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === meetingId
              ? { ...m, minutes_md: result.updated_minutes }
              : m
          )
        )

        return {
          createdCount: result.created_count,
          createdTasks: result.created_tasks.map((t) => ({
            taskId: t.task_id,
            title: t.title,
            specPath: t.spec_path,
            dueDate: t.due_date,
            lineNumber: t.line_number,
          })),
          updatedMinutes: result.updated_minutes,
        }
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to parse minutes')
        )
        throw err
      }
    },
    [supabase]
  )

  // AT-005: Preview minutes parsing without creating tasks
  const previewMinutes = useCallback(
    async (meetingId: string, minutesMd: string): Promise<MinutesPreviewResult> => {
      try {
        const result = await rpc.getMinutesPreview(supabase, {
          meetingId,
          minutesMd,
        })

        return {
          newSpecCount: result.new_spec_count,
          existingSpecCount: result.existing_spec_count,
          newSpecs: result.new_specs.map((s) => ({
            lineNumber: s.line_number,
            specPath: s.spec_path,
            title: s.title,
          })),
          existingSpecs: result.existing_specs.map((s) => ({
            lineNumber: s.line_number,
            specPath: s.spec_path,
            title: s.title,
            taskId: s.task_id || '',
          })),
        }
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to preview minutes')
        )
        throw err
      }
    },
    [supabase]
  )

  return {
    meetings,
    participants,
    loading,
    error,
    fetchMeetings,
    createMeeting,
    startMeeting,
    endMeeting,
    parseMinutes,
    previewMinutes,
  }
}
