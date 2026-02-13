import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config, getAuthContext } from '../config.js'
import { authorizeAndLog, type ActionType } from '../auth/index.js'

// Schemas
export const schedulingListSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  status: z.enum(['open', 'confirmed', 'cancelled', 'expired']).optional().describe('ステータスでフィルタ'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

export const schedulingCreateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  title: z.string().min(1).max(200).describe('提案タイトル'),
  description: z.string().max(1000).optional().describe('補足説明'),
  durationMinutes: z.number().min(15).max(480).default(60).describe('会議時間（分）'),
  slots: z.array(z.object({
    startAt: z.string().describe('開始日時 (ISO 8601)'),
    endAt: z.string().describe('終了日時 (ISO 8601)'),
  })).min(2).max(5).describe('候補日時（2〜5個）'),
  respondents: z.array(z.object({
    userId: z.string().uuid().describe('回答者UUID'),
    side: z.enum(['client', 'internal']).describe('クライアント or 社内'),
    isRequired: z.boolean().default(true).describe('必須回答者かどうか'),
  })).min(1).describe('回答者（1名以上、clientが1名以上必須）'),
  expiresAt: z.string().optional().describe('有効期限 (ISO 8601)'),
  videoProvider: z.enum(['google_meet', 'zoom', 'teams']).optional().describe('ビデオ会議プロバイダー'),
})

export const schedulingRespondSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  proposalId: z.string().uuid().describe('提案UUID'),
  responses: z.array(z.object({
    slotId: z.string().uuid().describe('スロットUUID'),
    response: z.enum(['available', 'unavailable_but_proceed', 'unavailable']).describe('回答: available=参加可能, unavailable_but_proceed=欠席OK, unavailable=参加不可'),
  })).min(1).describe('各スロットへの回答'),
})

export const schedulingConfirmSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  proposalId: z.string().uuid().describe('提案UUID'),
  slotId: z.string().uuid().describe('確定するスロットUUID'),
})

// Helper: permission check
async function checkAuth(spaceId: string, action: ActionType, toolName: string, resourceId?: string) {
  const ctx = getAuthContext()
  const result = await authorizeAndLog({
    ctx,
    spaceId,
    action,
    toolName,
    resourceType: 'scheduling_proposal',
    resourceId,
  })

  if (!result.allowed) {
    throw new Error(`権限エラー: ${result.reason}`)
  }

  return { ctx, role: result.role }
}

// Tool implementations
export async function schedulingList(params: z.infer<typeof schedulingListSchema>) {
  await checkAuth(params.spaceId, 'read', 'list_scheduling_proposals')

  const supabase = getSupabaseClient()

  let query = supabase
    .from('scheduling_proposals')
    .select('*, proposal_slots(*), proposal_respondents(*)')
    .eq('space_id', params.spaceId)
    .order('created_at', { ascending: false })
    .limit(params.limit)

  if (params.status) {
    query = query.eq('status', params.status)
  }

  const { data, error } = await query

  if (error) throw new Error(`日程調整一覧の取得に失敗しました: ${error.message}`)

  return {
    proposals: (data || []).map((p: any) => ({
      ...p,
      respondentCount: p.proposal_respondents?.length || 0,
      slotCount: p.proposal_slots?.length || 0,
    })),
  }
}

export async function schedulingCreate(params: z.infer<typeof schedulingCreateSchema>) {
  await checkAuth(params.spaceId, 'write', 'create_scheduling_proposal')

  const supabase = getSupabaseClient()

  // Validate: at least 1 client respondent
  const hasClient = params.respondents.some((r) => r.side === 'client')
  if (!hasClient) {
    throw new Error('クライアント参加者を1名以上指定してください')
  }

  // Get org_id from space
  const { data: space, error: spaceError } = await supabase
    .from('spaces')
    .select('org_id')
    .eq('id', params.spaceId)
    .single()

  if (spaceError || !space) {
    throw new Error('スペースが見つかりません')
  }

  // Create proposal
  const { data: proposal, error: proposalError } = await supabase
    .from('scheduling_proposals')
    .insert({
      org_id: space.org_id,
      space_id: params.spaceId,
      title: params.title,
      description: params.description || null,
      duration_minutes: params.durationMinutes,
      status: 'open',
      expires_at: params.expiresAt || null,
      video_provider: params.videoProvider || null,
      created_by: config.actorId,
    })
    .select('*')
    .single()

  if (proposalError) throw new Error(`提案の作成に失敗しました: ${proposalError.message}`)

  // Create slots
  const slotRows = params.slots.map((slot, idx) => ({
    proposal_id: proposal.id,
    start_at: slot.startAt,
    end_at: slot.endAt,
    slot_order: idx,
  }))

  const { error: slotsError } = await supabase
    .from('proposal_slots')
    .insert(slotRows)

  if (slotsError) throw new Error(`候補日時の作成に失敗しました: ${slotsError.message}`)

  // Create respondents
  const respondentRows = params.respondents.map((r) => ({
    proposal_id: proposal.id,
    user_id: r.userId,
    side: r.side,
    is_required: r.isRequired,
  }))

  const { error: respondentsError } = await supabase
    .from('proposal_respondents')
    .insert(respondentRows)

  if (respondentsError) throw new Error(`回答者の登録に失敗しました: ${respondentsError.message}`)

  return { proposal }
}

export async function schedulingRespond(params: z.infer<typeof schedulingRespondSchema>) {
  await checkAuth(params.spaceId, 'write', 'respond_to_proposal', params.proposalId)

  const supabase = getSupabaseClient()
  const ctx = getAuthContext()

  // Check proposal status
  const { data: proposal, error: proposalError } = await supabase
    .from('scheduling_proposals')
    .select('id, status, space_id')
    .eq('id', params.proposalId)
    .eq('space_id', params.spaceId)
    .single()

  if (proposalError || !proposal) {
    throw new Error('提案が見つかりません')
  }

  if (proposal.status !== 'open') {
    throw new Error(`この提案は現在「${proposal.status}」のため、回答できません`)
  }

  // Find respondent_id for current user
  const userId = ctx.userId || config.actorId
  const { data: respondent, error: respondentError } = await supabase
    .from('proposal_respondents')
    .select('id')
    .eq('proposal_id', params.proposalId)
    .eq('user_id', userId)
    .single()

  if (respondentError || !respondent) {
    throw new Error('この提案の回答者として登録されていません')
  }

  // Batch upsert all responses at once
  const now = new Date().toISOString()
  const rows = params.responses.map((resp) => ({
    slot_id: resp.slotId,
    respondent_id: respondent.id,
    response: resp.response,
    responded_at: now,
  }))

  const { error: upsertError } = await supabase
    .from('slot_responses')
    .upsert(rows, { onConflict: 'slot_id,respondent_id' })

  if (upsertError) {
    throw new Error(`回答の保存に失敗しました: ${upsertError.message}`)
  }

  return { ok: true, updatedCount: rows.length }
}

export async function schedulingConfirm(params: z.infer<typeof schedulingConfirmSchema>) {
  await checkAuth(params.spaceId, 'write', 'confirm_proposal_slot', params.proposalId)

  const supabase = getSupabaseClient()

  // Call the RPC function
  const { data, error } = await (supabase as any).rpc('rpc_confirm_proposal_slot', {
    p_proposal_id: params.proposalId,
    p_slot_id: params.slotId,
  })

  if (error) {
    throw new Error(`確定に失敗しました: ${error.message}`)
  }

  if (!data?.ok) {
    throw new Error(data?.error || '確定に失敗しました')
  }

  return {
    ok: true,
    meetingId: data.meeting_id,
    slotStart: data.slot_start,
    slotEnd: data.slot_end,
  }
}

// Tool definitions for MCP
export const schedulingTools = [
  {
    name: 'list_scheduling_proposals',
    description: '日程調整の提案一覧を取得します。spaceIdは必須です。statusでフィルタ可能です。',
    inputSchema: schedulingListSchema,
    handler: schedulingList,
  },
  {
    name: 'create_scheduling_proposal',
    description: '日程調整の提案を新規作成します。候補日時2〜5個とクライアント回答者1名以上が必須です。',
    inputSchema: schedulingCreateSchema,
    handler: schedulingCreate,
  },
  {
    name: 'respond_to_proposal',
    description: '日程調整の候補日時に回答します。各スロットに available/unavailable_but_proceed/unavailable で回答します。',
    inputSchema: schedulingRespondSchema,
    handler: schedulingRespond,
  },
  {
    name: 'confirm_proposal_slot',
    description: '日程調整のスロットを確定し、会議を作成します。全必須回答者が参加可能または欠席OKである必要があります。',
    inputSchema: schedulingConfirmSchema,
    handler: schedulingConfirm,
  },
]
