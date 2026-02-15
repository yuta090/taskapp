'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
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

/** 一覧表示用の軽量カラム（minutes_md を除外して転送量を削減） */
const MEETING_LIST_COLUMNS = `
  id,
  org_id,
  space_id,
  title,
  held_at,
  notes,
  status,
  started_at,
  ended_at,
  summary_subject,
  summary_body,
  created_at,
  updated_at,
  meeting_participants (*)
` as const

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

const MEETINGS_LIMIT = 50

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

  // Supabase client を useRef で安定化（遅延初期化で毎レンダー評価を回避）
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // フェッチのレース条件対策用カウンター
  const fetchIdRef = useRef(0)

  const fetchMeetings = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      // 1クエリで meetings + participants を取得（ネストselect）
      const { data: meetingsData, error: meetingsError } = await supabase
        .from('meetings')
        .select(MEETING_LIST_COLUMNS)
        .eq('space_id' as never, spaceId as never)
        .order('held_at', { ascending: false })
        .limit(MEETINGS_LIMIT)

      if (meetingsError) throw meetingsError

      // レース条件: 古いリクエストの結果を無視
      if (currentFetchId !== fetchIdRef.current) return

      const rawMeetings = (meetingsData || []) as Array<Record<string, unknown> & { id: string; meeting_participants?: unknown[] }>

      // participants をグルーピングし、meetings からは除去
      const participantsByMeeting: Record<string, MeetingParticipant[]> = {}
      const cleanMeetings: Meeting[] = rawMeetings.map((m) => {
        const { meeting_participants, ...meetingFields } = m
        if (Array.isArray(meeting_participants)) {
          participantsByMeeting[m.id] = meeting_participants as MeetingParticipant[]
        }
        return meetingFields as unknown as Meeting
      })

      setMeetings(cleanMeetings)
      setParticipants(participantsByMeeting)
    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return
      setError(
        err instanceof Error ? err : new Error('Failed to fetch meetings')
      )
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [spaceId, supabase])

  /** 選択された会議の詳細をオンデマンドで取得し、ローカルstateも更新 */
  const fetchMeetingDetail = useCallback(
    async (meetingId: string): Promise<Meeting | null> => {
      try {
        const { data, error: fetchError } = await supabase
          .from('meetings')
          .select('*')
          .eq('id' as never, meetingId as never)
          .single()

        if (fetchError) throw fetchError
        const fullMeeting = data as Meeting

        // ローカルstateを更新
        setMeetings((prev) =>
          prev.map((m) => (m.id === meetingId ? fullMeeting : m))
        )

        return fullMeeting
      } catch (err) {
        setError(
          err instanceof Error ? err : new Error('Failed to fetch meeting detail')
        )
        return null
      }
    },
    [supabase]
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

      setMeetings((prev) => [optimisticMeeting, ...prev])

      try {
        const { data: authData, error: authError } =
          await supabase.auth.getUser()
        if (authError) throw authError
        if (!authData?.user) {
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
            created_by: authData.user.id,
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
          const { data: insertedParticipants, error: participantError } = await (supabase as SupabaseClient)
            .from('meeting_participants')
            .insert(participantRows)
            .select('*')
          if (participantError) throw participantError

          // 参加者もオプティミスティック更新
          if (insertedParticipants) {
            setParticipants((prev) => ({
              ...prev,
              [createdMeeting.id]: insertedParticipants as MeetingParticipant[],
            }))
          }
        }

        // オプティミスティック更新: tempId → 実際のIDに差し替え
        setMeetings((prev) =>
          prev.map((m) => (m.id === tempId ? createdMeeting : m))
        )

        return createdMeeting
      } catch (err) {
        setMeetings((prev) => prev.filter((m) => m.id !== tempId))
        setError(
          err instanceof Error ? err : new Error('Failed to create meeting')
        )
        throw err
      }
    },
    [orgId, spaceId, supabase]
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
      } catch (err) {
        // エラー時のみ最新データを再取得
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

        // サーバー応答で summary を更新
        setMeetings((prev) =>
          prev.map((m) =>
            m.id === meetingId
              ? {
                  ...m,
                  status: 'ended' as const,
                  summary_subject: result.summary_subject,
                  summary_body: result.summary_body,
                }
              : m
          )
        )

        return {
          summary_subject: result.summary_subject,
          summary_body: result.summary_body,
          counts: result.counts,
        }
      } catch (err) {
        // エラー時のみ最新データを再取得
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
    fetchMeetingDetail,
    createMeeting,
    startMeeting,
    endMeeting,
    parseMinutes,
    previewMinutes,
  }
}
