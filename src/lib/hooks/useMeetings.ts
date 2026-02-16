'use client'

import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rpc } from '@/lib/supabase/rpc'
import { getCachedUser } from '@/lib/supabase/cached-auth'
import { fetchMeetingsQuery } from '@/lib/supabase/queries'
import type { MeetingsQueryData } from '@/lib/supabase/queries'
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

// MEETING_LIST_COLUMNS and MeetingsQueryData are imported from @/lib/supabase/queries

interface UseMeetingsReturn {
  meetings: Meeting[]
  participants: Record<string, MeetingParticipant[]>
  loading: boolean
  error: Error | null
  fetchMeetings: () => Promise<void>
  /** 選択された会議の詳細（minutes_md等）をオンデマンドで取得 */
  fetchMeetingDetail: (meetingId: string) => Promise<Meeting | null>
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
  const queryClient = useQueryClient()

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const queryKey = ['meetings', spaceId] as const

  const { data, isPending, error: queryError } = useQuery<MeetingsQueryData>({
    queryKey,
    queryFn: () => fetchMeetingsQuery(supabase as SupabaseClient, spaceId),
    enabled: !!spaceId,
  })

  const meetings = data?.meetings ?? []
  const participants = data?.participants ?? {}

  const fetchMeetings = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['meetings', spaceId] })
  }, [queryClient, spaceId])

  /** 選択された会議の詳細をオンデマンドで取得し、ローカルcacheも更新 */
  const fetchMeetingDetail = useCallback(
    async (meetingId: string): Promise<Meeting | null> => {
      try {
        const { data: detailData, error: fetchError } = await supabase
          .from('meetings')
          .select('*')
          .eq('id' as never, meetingId as never)
          .single()

        if (fetchError) throw fetchError
        const fullMeeting = detailData as Meeting

        // ローカルcacheを更新
        queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
          if (!old) return { meetings: [fullMeeting], participants: {} }
          return {
            meetings: old.meetings.map((m) => (m.id === meetingId ? fullMeeting : m)),
            participants: old.participants,
          }
        })

        return fullMeeting
      } catch (err) {
        throw err instanceof Error ? err : new Error('Failed to fetch meeting detail')
      }
    },
    [supabase, queryClient, spaceId]
  )

  const createMeeting = useCallback(
    async (meeting: CreateMeetingInput) => {
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

      queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => ({
        meetings: [optimisticMeeting, ...(old?.meetings ?? [])],
        participants: old?.participants ?? {},
      }))

      try {
        const { user: authUser, error: authError } =
          await getCachedUser(supabase)
        if (authError) throw authError
        if (!authUser) {
          throw new Error('ログインが必要です')
        }

        const { data: created, error: createError } = await (supabase as SupabaseClient)
          .from('meetings')
          .insert({
            org_id: orgId,
            space_id: spaceId,
            title: meeting.title,
            held_at: heldAt,
            status: 'planned',
            created_by: authUser.id,
          })
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
            created_by: authUser.id,
          })),
          ...meeting.internalParticipantIds.map((userId) => ({
            meeting_id: createdMeeting.id,
            user_id: userId,
            side: 'internal' as const,
            created_by: authUser.id,
          })),
        ]

        if (participantRows.length > 0) {
          const { data: insertedParticipants, error: participantError } = await (supabase as SupabaseClient)
            .from('meeting_participants')
            .insert(participantRows)
            .select('*')
          if (participantError) throw participantError

          // 参加者もキャッシュ更新
          if (insertedParticipants) {
            queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => ({
              meetings: old?.meetings ?? [],
              participants: {
                ...(old?.participants ?? {}),
                [createdMeeting.id]: insertedParticipants as MeetingParticipant[],
              },
            }))
          }
        }

        // オプティミスティック更新: tempId -> 実際のIDに差し替え
        queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => ({
          meetings: (old?.meetings ?? []).map((m) => (m.id === tempId ? createdMeeting : m)),
          participants: old?.participants ?? {},
        }))

        return createdMeeting
      } catch (err) {
        queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => ({
          meetings: (old?.meetings ?? []).filter((m) => m.id !== tempId),
          participants: old?.participants ?? {},
        }))
        throw err
      }
    },
    [orgId, spaceId, supabase, queryClient]
  )

  const startMeeting = useCallback(
    async (meetingId: string) => {
      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<MeetingsQueryData>(['meetings', spaceId])

      // Optimistic update
      queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
        if (!old) return { meetings: [], participants: {} }
        return {
          meetings: old.meetings.map((m) =>
            m.id === meetingId
              ? { ...m, status: 'in_progress' as const, started_at: new Date().toISOString() }
              : m
          ),
          participants: old.participants,
        }
      })

      try {
        await rpc.meetingStart(supabase, { meetingId })
      } catch (err) {
        // エラー時はキャッシュ復元 + 再フェッチ
        if (previousData) {
          queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], previousData)
        }
        await queryClient.invalidateQueries({ queryKey: ['meetings', spaceId] })
        throw err
      }
    },
    [supabase, queryClient, spaceId]
  )

  const endMeeting = useCallback(
    async (meetingId: string) => {
      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<MeetingsQueryData>(['meetings', spaceId])

      // Optimistic update
      queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
        if (!old) return { meetings: [], participants: {} }
        return {
          meetings: old.meetings.map((m) =>
            m.id === meetingId
              ? { ...m, status: 'ended' as const, ended_at: new Date().toISOString() }
              : m
          ),
          participants: old.participants,
        }
      })

      try {
        const result = await rpc.meetingEnd(supabase, { meetingId })

        // サーバー応答で summary を更新
        queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
          if (!old) return { meetings: [], participants: {} }
          return {
            meetings: old.meetings.map((m) =>
              m.id === meetingId
                ? {
                    ...m,
                    status: 'ended' as const,
                    summary_subject: result.summary_subject,
                    summary_body: result.summary_body,
                  }
                : m
            ),
            participants: old.participants,
          }
        })

        return {
          summary_subject: result.summary_subject,
          summary_body: result.summary_body,
          counts: result.counts,
        }
      } catch (err) {
        // エラー時はキャッシュ復元 + 再フェッチ
        if (previousData) {
          queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], previousData)
        }
        await queryClient.invalidateQueries({ queryKey: ['meetings', spaceId] })
        throw err
      }
    },
    [supabase, queryClient, spaceId]
  )

  // AT-005: Parse meeting minutes and create SPEC tasks
  const parseMinutes = useCallback(
    async (meetingId: string, minutesMd: string): Promise<ParseMinutesResult> => {
      try {
        const result = await rpc.parseMeetingMinutes(supabase, {
          meetingId,
          minutesMd,
        })

        // Update local cache with new minutes
        queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
          if (!old) return { meetings: [], participants: {} }
          return {
            meetings: old.meetings.map((m) =>
              m.id === meetingId
                ? { ...m, minutes_md: result.updated_minutes }
                : m
            ),
            participants: old.participants,
          }
        })

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
        throw err instanceof Error ? err : new Error('Failed to parse minutes')
      }
    },
    [supabase, queryClient, spaceId]
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
        throw err instanceof Error ? err : new Error('Failed to preview minutes')
      }
    },
    [supabase]
  )

  return {
    meetings,
    participants,
    loading: isPending && !data,
    error: queryError,
    fetchMeetings,
    fetchMeetingDetail,
    createMeeting,
    startMeeting,
    endMeeting,
    parseMinutes,
    previewMinutes,
  }
}
