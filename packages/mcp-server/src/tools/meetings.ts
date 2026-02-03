import { z } from 'zod'
import { getSupabaseClient, Meeting } from '../supabase/client.js'
import { config } from '../config.js'

// Schemas
export const meetingCreateSchema = z.object({
  title: z.string().min(1).describe('会議タイトル'),
  heldAt: z.string().optional().describe('開催日時 (ISO8601)'),
  notes: z.string().optional().describe('事前メモ'),
  participantIds: z.array(z.string().uuid()).default([]).describe('参加者UUID配列'),
})

export const meetingStartSchema = z.object({
  meetingId: z.string().uuid().describe('会議UUID'),
})

export const meetingEndSchema = z.object({
  meetingId: z.string().uuid().describe('会議UUID'),
})

export const meetingListSchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUID'),
  status: z.enum(['planned', 'in_progress', 'ended']).optional().describe('ステータスでフィルタ'),
  limit: z.number().min(1).max(100).default(20).describe('取得件数'),
})

export const meetingGetSchema = z.object({
  meetingId: z.string().uuid().describe('会議UUID'),
})

// Tool implementations
export async function meetingCreate(params: z.infer<typeof meetingCreateSchema>): Promise<Meeting> {
  const supabase = getSupabaseClient()
  const spaceId = config.spaceId
  const orgId = config.orgId

  const { data: meeting, error } = await supabase
    .from('meetings')
    .insert({
      org_id: orgId,
      space_id: spaceId,
      title: params.title,
      held_at: params.heldAt || null,
      notes: params.notes || null,
      status: 'planned',
    })
    .select('*')
    .single()

  if (error) throw new Error('会議の作成に失敗しました')

  // Add participants
  if (params.participantIds.length > 0) {
    const participantRows = params.participantIds.map((userId) => ({
      org_id: orgId,
      space_id: spaceId,
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

export async function meetingStart(params: z.infer<typeof meetingStartSchema>): Promise<{ ok: boolean; meeting: Meeting }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Pre-validate: verify meeting belongs to current tenant before RPC
  const { data: existingMeeting, error: checkError } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (checkError || !existingMeeting) {
    throw new Error('会議が見つかりません')
  }

  const { data, error } = await supabase.rpc('rpc_meeting_start', {
    p_meeting_id: params.meetingId,
  })

  if (error) throw new Error('会議の開始に失敗しました')

  // Fetch updated meeting with org/space scoping
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (meetingError) throw new Error('会議が見つかりません')

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
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Pre-validate: verify meeting belongs to current tenant before RPC
  const { data: existingMeeting, error: checkError } = await supabase
    .from('meetings')
    .select('id')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (checkError || !existingMeeting) {
    throw new Error('会議が見つかりません')
  }

  const { data, error } = await supabase.rpc('rpc_meeting_end', {
    p_meeting_id: params.meetingId,
  })

  if (error) throw new Error('会議の終了に失敗しました')

  // Fetch updated meeting with org/space scoping
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (meetingError) throw new Error('会議が見つかりません')

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
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = params.spaceId || config.spaceId

  // Enforce org/space scoping
  let query = supabase
    .from('meetings')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .order('held_at', { ascending: false, nullsFirst: false })
    .limit(params.limit)

  if (params.status) {
    query = query.eq('status', params.status)
  }

  const { data, error } = await query

  if (error) throw new Error('会議一覧の取得に失敗しました')
  return (data || []) as Meeting[]
}

export async function meetingGet(params: z.infer<typeof meetingGetSchema>): Promise<{ meeting: Meeting; participants: { user_id: string; side: string }[] }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Enforce org/space scoping
  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('*')
    .eq('id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (meetingError) throw new Error('会議が見つかりません')

  const { data: participants, error: participantsError } = await supabase
    .from('meeting_participants')
    .select('user_id, side')
    .eq('meeting_id', params.meetingId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)

  if (participantsError) throw new Error('参加者の取得に失敗しました')

  return {
    meeting: meeting as Meeting,
    participants: participants || [],
  }
}

// Tool definitions for MCP
export const meetingTools = [
  {
    name: 'meeting_create',
    description: '新しい会議を作成します。',
    inputSchema: meetingCreateSchema,
    handler: meetingCreate,
  },
  {
    name: 'meeting_start',
    description: '会議を開始します（planned → in_progress）。RPCを使用。',
    inputSchema: meetingStartSchema,
    handler: meetingStart,
  },
  {
    name: 'meeting_end',
    description: '会議を終了します。自動サマリー生成付き。',
    inputSchema: meetingEndSchema,
    handler: meetingEnd,
  },
  {
    name: 'meeting_list',
    description: '会議一覧を取得します。statusでフィルタ可能。',
    inputSchema: meetingListSchema,
    handler: meetingList,
  },
  {
    name: 'meeting_get',
    description: '会議の詳細と参加者を取得します。',
    inputSchema: meetingGetSchema,
    handler: meetingGet,
  },
]
