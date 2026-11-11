import { z } from 'zod'
import { getSupabaseClient, Meeting } from '../supabase/client.js'
import { checkAuth } from '../auth/helpers.js'
import { getAuthContext } from '../config.js'
import { ToolUserError } from '../errors.js'
import { assertUsersAreSpaceMembers, requireActorUserId } from '../auth/scope.js'
import { mapRaiseExceptionError } from '../lib/rpcErrors.js'
import { buildMinutesLink, withLink } from '../lib/appLinks.js'
import { notFoundOr, hideDbError } from '../lib/dbErrors.js'
import { assertWriteApplied } from '../lib/staleWrite.js'

// Helper: get orgId from spaceId
async function getOrgId(spaceId: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  if (error) throw notFoundOr(error, 'meetings/getOrgId', 'スペースが見つかりません', 'スペースの取得に失敗しました')
  if (!data) throw new ToolUserError('スペースが見つかりません', 404)
  return data.org_id
}

// Schemas
export const meetingCreateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  title: z.string().min(1).describe('会議タイトル'),
  heldAt: z.string().optional().describe('開催日時 (ISO8601)'),
  notes: z.string().optional().describe('事前メモ'),
  participantIds: z.array(z.string().uuid()).default([]).describe('参加者UUID配列'),
})

// 作ったあとの題名・開催日時を直す。参加者の入れ替えは別の表で途中失敗の扱いが要るので、ここでは扱わない。
// refine で包まない（MCP の登録が inputSchema.shape を読むため）。「直す項目が無い」は処理の中で断る。
export const meetingUpdateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  meetingId: z.string().uuid().describe('会議UUID'),
  title: z.string().min(1).optional().describe('新しい会議タイトル'),
  heldAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('新しい開催日時（ISO8601・時差付き。例 2026-11-12T15:00:00+09:00）。時差が無いと UTC として9時間ずれるので断る'),
  expectedUpdatedAt: z
    .string()
    .optional()
    .describe(
      '直前の meeting_get で受け取った meeting.updated_at をそのまま渡す。渡すと、その版のままのときだけ書き換える。渡さないと、他の人が先に直した内容を黙って上書きする'
    ),
})

export const meetingStartSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  meetingId: z.string().uuid().describe('会議UUID'),
})

export const meetingEndSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  meetingId: z.string().uuid().describe('会議UUID'),
})

export const meetingListSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  status: z.enum(['planned', 'in_progress', 'ended']).optional().describe('ステータスでフィルタ'),
  limit: z.number().min(1).max(100).default(20).describe('取得件数'),
})

export const meetingGetSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  meetingId: z.string().uuid().describe('会議UUID'),
})

// Tool implementations
export async function meetingCreate(params: z.infer<typeof meetingCreateSchema>): Promise<Meeting> {
  await checkAuth(params.spaceId, 'write', 'meeting_create', 'meeting')
  // 作成者（meetings.created_by・NOT NULL）は、この呼び出しの鍵の利用者。
  // config.actorId は前の呼び出しの値が残ることがあるので使わない
  const createdBy = getAuthContext().userId
  if (!createdBy) {
    throw new ToolUserError('この鍵には利用者が紐づいていないため、会議を作成できません。個人の鍵を使ってください', 400)
  }
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  // 参加者は、画面の参加者選択肢と同じ範囲（このプロジェクトのメンバー）に限る
  await assertUsersAreSpaceMembers(params.participantIds, params.spaceId)

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      org_id: orgId,
      space_id: params.spaceId,
      title: params.title,
      // held_at は NOT NULL。省いたら今の時刻（timestamptz なので UTC の ISO 文字列でよい）
      held_at: params.heldAt || new Date().toISOString(),
      notes: params.notes || null,
      status: 'planned',
      created_by: createdBy,
    })
    .select('*')
    .single()

  if (error) throw hideDbError(error, 'meeting_create', '会議の作成に失敗しました')

  if (params.participantIds.length > 0) {
    const participantRows = params.participantIds.map((userId) => ({
      org_id: orgId,
      space_id: params.spaceId,
      meeting_id: meeting.id,
      user_id: userId,
      side: 'internal' as const,
    }))

    const { error: participantError } = await supabase
      .from('meeting_participants')
      .insert(participantRows)

    if (participantError) {
      console.error('参加者登録失敗:', participantError.message)
    }
  }

  return meeting as Meeting
}

export async function meetingUpdate(params: z.infer<typeof meetingUpdateSchema>): Promise<Meeting> {
  const patch: { title?: string; held_at?: string } = {}
  if (params.title !== undefined) patch.title = params.title
  if (params.heldAt !== undefined) patch.held_at = params.heldAt
  if (Object.keys(patch).length === 0) {
    throw new ToolUserError('直す項目がありません。title か heldAt を渡してください', 400)
  }

  await checkAuth(params.spaceId, 'write', 'meeting_update', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  // expectedUpdatedAt を渡されたときだけ、その版のままの行に限って書く（minutes_update と同じ楽観ロック）。
  // .single() は使わない — 0行のとき例外になり、競合と「見つからない」を区別できないため。
  let query = supabase
    .from('meetings')
    .update(patch)
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
  if (params.expectedUpdatedAt !== undefined) {
    query = query.eq('updated_at', params.expectedUpdatedAt)
  }

  const { data, error } = await query.select('*')
  if (error) throw hideDbError(error, 'meeting_update', '会議の更新に失敗しました')

  const rows = (data ?? []) as Meeting[]
  assertWriteApplied(rows.length, params.expectedUpdatedAt, '会議が見つかりません')
  return rows[0] as Meeting
}

export async function meetingStart(params: z.infer<typeof meetingStartSchema>): Promise<{ ok: boolean; meeting: Meeting }> {
  await checkAuth(params.spaceId, 'write', 'meeting_start', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data: existingMeeting, error: checkError } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (checkError) throw notFoundOr(checkError, 'meeting_start (check)', '会議が見つかりません', '会議の確認に失敗しました')
  if (!existingMeeting) throw new ToolUserError('会議が見つかりません', 404)

  // 誰が開始したか（task_events.actor_id）は、鍵に紐づく利用者から取る
  const actor = requireActorUserId()

  const { error } = await supabase.rpc('rpc_meeting_start_as', {
    p_actor: actor,
    p_meeting_id: params.meetingId,
  })

  if (error) throw mapRaiseExceptionError(error.message, '会議の開始に失敗しました')

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (meetingError) throw notFoundOr(meetingError, 'meeting_start (reload)', '会議が見つかりません', '会議の取得に失敗しました')

  return { ok: true, meeting: meeting as Meeting }
}

export interface MeetingEndResult {
  ok: boolean
  meeting: Meeting
  summary: {
    subject: string
    body: string
    counts: {
      decided: number
      open: number
      ball_client: number
    }
  }
}

export async function meetingEnd(params: z.infer<typeof meetingEndSchema>): Promise<MeetingEndResult> {
  await checkAuth(params.spaceId, 'write', 'meeting_end', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data: existingMeeting, error: checkError } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (checkError) throw notFoundOr(checkError, 'meeting_end (check)', '会議が見つかりません', '会議の確認に失敗しました')
  if (!existingMeeting) throw new ToolUserError('会議が見つかりません', 404)

  // 誰が終了したか（task_events.actor_id）は、鍵に紐づく利用者から取る
  const actor = requireActorUserId()

  const { data, error } = await supabase.rpc('rpc_meeting_end_as', {
    p_actor: actor,
    p_meeting_id: params.meetingId,
  })

  if (error) throw mapRaiseExceptionError(error.message, '会議の終了に失敗しました')

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (meetingError) throw notFoundOr(meetingError, 'meeting_end (reload)', '会議が見つかりません', '会議の取得に失敗しました')

  return {
    ok: true,
    meeting: meeting as Meeting,
    summary: {
      subject: data?.summary_subject || '',
      body: data?.summary_body || '',
      counts: data?.counts || { decided: 0, open: 0, ball_client: 0 },
    },
  }
}

export async function meetingList(params: z.infer<typeof meetingListSchema>): Promise<Meeting[]> {
  await checkAuth(params.spaceId, 'read', 'meeting_list', 'meeting')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  let query = supabase
    .from('meetings')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .order('held_at', { ascending: false, nullsFirst: false })
    .limit(params.limit)

  if (params.status) {
    query = query.eq('status', params.status)
  }

  const { data, error } = await query

  if (error) throw hideDbError(error, 'meeting_list', '会議一覧の取得に失敗しました')
  // link はそのまま Wiki・議事録の本文に貼れる（画面側の「リンクを挿入」と同じ形）
  return ((data || []) as Meeting[]).map((meeting) =>
    withLink(meeting, buildMinutesLink(orgId, params.spaceId, meeting.id))
  ) as Meeting[]
}

export async function meetingGet(params: z.infer<typeof meetingGetSchema>): Promise<{ meeting: Meeting; participants: { user_id: string; side: string }[] }> {
  await checkAuth(params.spaceId, 'read', 'meeting_get', 'meeting', params.meetingId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (meetingError) throw notFoundOr(meetingError, 'meeting_get', '会議が見つかりません', '会議の取得に失敗しました')

  const { data: participants, error: participantsError } = await supabase
    .from('meeting_participants')
    .select('user_id, side')
    .eq('meeting_id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)

  if (participantsError) throw hideDbError(participantsError, 'meeting_get (participants)', '参加者の取得に失敗しました')

  return {
    meeting: withLink(meeting as Meeting, buildMinutesLink(orgId, params.spaceId, params.meetingId)) as Meeting,
    participants: participants || [],
  }
}

// Tool definitions for MCP
export const meetingTools = [
  {
    name: 'meeting_create',
    description: '会議新規作成',
    inputSchema: meetingCreateSchema,
    handler: meetingCreate,
  },
  {
    name: 'meeting_update',
    description: '会議の題名・開催日時を直す。直前の meeting_get の meeting.updated_at を expectedUpdatedAt に渡すと、他の人の更新を上書きしない',
    inputSchema: meetingUpdateSchema,
    handler: meetingUpdate,
  },
  {
    name: 'meeting_start',
    description: '会議開始(planned→in_progress)',
    inputSchema: meetingStartSchema,
    handler: meetingStart,
  },
  {
    name: 'meeting_end',
    description: '会議終了+自動サマリー生成',
    inputSchema: meetingEndSchema,
    handler: meetingEnd,
  },
  {
    name: 'meeting_list',
    description: '会議一覧取得。statusフィルタ可',
    inputSchema: meetingListSchema,
    handler: meetingList,
  },
  {
    name: 'meeting_get',
    description: '会議詳細+参加者取得',
    inputSchema: meetingGetSchema,
    handler: meetingGet,
  },
]
