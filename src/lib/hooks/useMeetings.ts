'use client'

import { useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rpc } from '@/lib/supabase/rpc'
import { getCachedUser } from '@/lib/supabase/cached-auth'
import { fetchMeetingsQuery, MEETING_DETAIL_COLUMNS } from '@/lib/supabase/queries'
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

export interface ParseMinutesResult {
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

/**
 * 議事録の Web 保存で「開いたときの updated_at のままの行だけ書く」楽観ロックが
 * 0 行にマッチしたときの失敗（＝別の場所で本文が更新済み）。DB エラーとは区別する。
 */
export class MinutesConflictError extends Error {
  constructor(message = 'この議事録は、別の場所で更新されています') {
    super(message)
    this.name = 'MinutesConflictError'
  }
}

export interface MinutesPreviewResult {
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
  /** C2: 会議と議事録を削除する。日程調整(scheduling_proposals)に紐づく場合はブロックする */
  deleteMeeting: (meetingId: string) => Promise<void>
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
  /**
   * 議事録の Web 編集を保存する。開いたときの `updated_at`（baseUpdatedAt）と一致する
   * 行だけを書き換える楽観ロック。0 件なら別の場所（AI・コマンド・ほかの人）で更新済みと
   * みなし MinutesConflictError を投げる。成功したら新しい updated_at を返す。
   */
  updateMinutes: (meetingId: string, minutesMd: string, baseUpdatedAt: string) => Promise<string>
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
        const { data: detailData, error: fetchError } = await (supabase as SupabaseClient)
          .from('meetings')
          .select(MEETING_DETAIL_COLUMNS)
          .eq('id', meetingId)
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
          .select(MEETING_DETAIL_COLUMNS)
          .single()

        if (createError) throw createError

        const createdMeeting = created as Meeting

        // 参加者を登録（org_id / space_id は表の必須列。会議と同じ値を入れる）。
        // created_by は送らない: 列の既定値 auth.uid() がログイン中の利用者を入れる（ブラウザから他人を登録者にさせない）
        const participantBase = {
          org_id: createdMeeting.org_id,
          space_id: createdMeeting.space_id,
          meeting_id: createdMeeting.id,
        }
        const participantRows = [
          ...meeting.clientParticipantIds.map((userId) => ({
            ...participantBase,
            user_id: userId,
            side: 'client' as const,
          })),
          ...meeting.internalParticipantIds.map((userId) => ({
            ...participantBase,
            user_id: userId,
            side: 'internal' as const,
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

  // C2: 会議の削除。scheduling_proposals.confirmed_meeting_id → meetings は
  // ON DELETE NO ACTION のため、紐づく日程調整が残っていると DELETE が失敗する。
  // 事前にチェックしてブロックし、参照の付け替えはしない。
  const deleteMeeting = useCallback(
    async (meetingId: string): Promise<void> => {
      const { data: linkedProposals, error: checkError } = await (supabase as SupabaseClient)
        .from('scheduling_proposals')
        .select('id')
        .eq('confirmed_meeting_id', meetingId)
        .limit(1)

      if (checkError) throw checkError
      if (linkedProposals && linkedProposals.length > 0) {
        throw new Error('この会議は日程調整に紐づいているため削除できません')
      }

      // Capture previous state for rollback
      const previousData = queryClient.getQueryData<MeetingsQueryData>(['meetings', spaceId])

      // Optimistic update
      queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
        if (!old) return { meetings: [], participants: {} }
        const nextParticipants = { ...old.participants }
        delete nextParticipants[meetingId]
        return {
          meetings: old.meetings.filter((m) => m.id !== meetingId),
          participants: nextParticipants,
        }
      })

      try {
        const { error: deleteError } = await (supabase as SupabaseClient)
          .from('meetings')
          .delete()
          .eq('id', meetingId)

        if (deleteError) throw deleteError
      } catch (err) {
        if (previousData) {
          queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], previousData)
        }
        throw err instanceof Error ? err : new Error('Failed to delete meeting')
      }
    },
    [supabase, queryClient, spaceId]
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

  // 議事録の Web 編集の保存。`.single()` は使わない — 0 件マッチのとき例外にならず
  // 「別の場所で更新済みか」を判定できないため、配列のまま長さで見る。
  // baseUpdatedAt は受け取った文字列をそのまま `.eq()` に渡す（`new Date()` を通すと
  // 1/1000秒に丸まり、DB は 1/1000000秒のため毎回一致しなくなる）。
  const updateMinutes = useCallback(
    async (meetingId: string, minutesMd: string, baseUpdatedAt: string): Promise<string> => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('meetings')
        .update({ minutes_md: minutesMd })
        .eq('id', meetingId)
        .eq('updated_at', baseUpdatedAt)
        .select('id, minutes_md, updated_at')

      if (error) throw error

      const rows = (data ?? []) as Array<{ id: string; minutes_md: string | null; updated_at: string }>
      if (rows.length === 0) {
        throw new MinutesConflictError()
      }
      const updated = rows[0]

      queryClient.setQueryData<MeetingsQueryData>(['meetings', spaceId], (old) => {
        if (!old) return { meetings: [], participants: {} }
        return {
          meetings: old.meetings.map((m) =>
            m.id === meetingId
              ? { ...m, minutes_md: updated.minutes_md, updated_at: updated.updated_at }
              : m
          ),
          participants: old.participants,
        }
      })

      return updated.updated_at
    },
    [supabase, queryClient, spaceId]
  )

  return {
    meetings,
    participants,
    loading: isPending && !data,
    error: queryError,
    fetchMeetings,
    fetchMeetingDetail,
    createMeeting,
    deleteMeeting,
    startMeeting,
    endMeeting,
    parseMinutes,
    previewMinutes,
    updateMinutes,
  }
}
