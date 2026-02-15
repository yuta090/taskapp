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

export const schedulingCancelSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  proposalId: z.string().uuid().describe('提案UUID'),
  action: z.enum(['cancel', 'extend']).describe('cancel=キャンセル, extend=期限延長'),
  newExpiresAt: z.string().optional().describe('新しい有効期限 (ISO 8601)。action=extend時に必須'),
})

export const schedulingResponsesSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  proposalId: z.string().uuid().describe('提案UUID'),
})

export const schedulingSuggestSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  userIds: z.array(z.string().uuid()).min(1).max(10).describe('空き時間を調べるユーザーUUID配列（最大10名）'),
  startDate: z.string().describe('対象開始日 (YYYY-MM-DD)'),
  endDate: z.string().describe('対象終了日 (YYYY-MM-DD)'),
  durationMinutes: z.number().min(15).max(480).default(60).describe('会議時間（分）'),
  businessHourStart: z.number().min(0).max(23).default(9).describe('営業開始時刻（時）'),
  businessHourEnd: z.number().min(1).max(24).default(18).describe('営業終了時刻（時）'),
})

export const schedulingReminderSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  proposalId: z.string().uuid().describe('提案UUID'),
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
    proposals: (data || []).map((p: { id: string; proposal_respondents?: Array<unknown>; proposal_slots?: Array<unknown> } & Record<string, unknown>) => ({
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
  const { data, error } = await supabase.rpc('rpc_confirm_proposal_slot', {
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

// ── New tool implementations ─────────────────────────────

export async function schedulingCancel(params: z.infer<typeof schedulingCancelSchema>) {
  await checkAuth(params.spaceId, 'write', 'cancel_scheduling_proposal', params.proposalId)

  const supabase = getSupabaseClient()

  // Fetch proposal
  const { data: proposal, error: fetchError } = await supabase
    .from('scheduling_proposals')
    .select('id, status, space_id, created_by')
    .eq('id', params.proposalId)
    .eq('space_id', params.spaceId)
    .single()

  if (fetchError || !proposal) {
    throw new Error('提案が見つかりません')
  }

  if (proposal.status !== 'open') {
    throw new Error(`この提案は現在「${proposal.status}」のため、変更できません`)
  }

  if (params.action === 'cancel') {
    // Atomic: only update if still open (prevents TOCTOU race)
    const { data: updated, error } = await supabase
      .from('scheduling_proposals')
      .update({ status: 'cancelled' })
      .eq('id', params.proposalId)
      .eq('space_id', params.spaceId)
      .eq('status', 'open')
      .select('id')

    if (error) throw new Error(`キャンセルに失敗しました: ${error.message}`)
    if (!updated || updated.length === 0) {
      throw new Error('提案は既に変更されています（別の操作が先に実行された可能性があります）')
    }
    return { ok: true, action: 'cancelled', proposalId: params.proposalId }
  }

  // action === 'extend'
  if (!params.newExpiresAt) {
    throw new Error('期限延長には newExpiresAt が必須です')
  }

  const newExpiry = new Date(params.newExpiresAt)
  if (isNaN(newExpiry.getTime()) || newExpiry <= new Date()) {
    throw new Error('newExpiresAt は未来の有効な日時を指定してください')
  }

  // Atomic: only update if still open (prevents TOCTOU race)
  const { data: updated, error } = await supabase
    .from('scheduling_proposals')
    .update({ expires_at: params.newExpiresAt })
    .eq('id', params.proposalId)
    .eq('space_id', params.spaceId)
    .eq('status', 'open')
    .select('id')

  if (error) throw new Error(`期限延長に失敗しました: ${error.message}`)
  if (!updated || updated.length === 0) {
    throw new Error('提案は既に変更されています（別の操作が先に実行された可能性があります）')
  }
  return { ok: true, action: 'extended', proposalId: params.proposalId, newExpiresAt: params.newExpiresAt }
}

interface RespondentRow {
  id: string
  user_id: string
  side: string
  is_required: boolean
  slot_responses: Array<{
    slot_id: string
    response: string
    responded_at: string
  }>
}

interface SlotRow {
  id: string
  start_at: string
  end_at: string
  slot_order: number
  slot_responses: Array<{
    respondent_id: string
    response: string
  }>
}

export async function schedulingGetResponses(params: z.infer<typeof schedulingResponsesSchema>) {
  await checkAuth(params.spaceId, 'read', 'get_proposal_responses', params.proposalId)

  const supabase = getSupabaseClient()

  // Fetch proposal with respondents + their responses
  const { data: proposal, error: proposalError } = await supabase
    .from('scheduling_proposals')
    .select('id, title, status, expires_at, duration_minutes, created_at')
    .eq('id', params.proposalId)
    .eq('space_id', params.spaceId)
    .single()

  if (proposalError || !proposal) {
    throw new Error('提案が見つかりません')
  }

  // Fetch respondents with their responses
  const { data: respondents, error: respondentError } = await supabase
    .from('proposal_respondents')
    .select('id, user_id, side, is_required, slot_responses(slot_id, response, responded_at)')
    .eq('proposal_id', params.proposalId)

  if (respondentError) throw new Error(`回答者情報の取得に失敗しました: ${respondentError.message}`)

  // Fetch slots with responses
  const { data: slots, error: slotsError } = await supabase
    .from('proposal_slots')
    .select('id, start_at, end_at, slot_order, slot_responses(respondent_id, response)')
    .eq('proposal_id', params.proposalId)
    .order('slot_order', { ascending: true })

  if (slotsError) throw new Error(`スロット情報の取得に失敗しました: ${slotsError.message}`)

  // Enrich respondents with display_name
  const userIds = (respondents as RespondentRow[]).map((r) => r.user_id)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', userIds)

  const profileMap = new Map<string, string>()
  for (const p of (profiles || []) as Array<{ id: string; display_name: string | null }>) {
    profileMap.set(p.id, p.display_name || '(名前未設定)')
  }

  const enrichedRespondents = (respondents as RespondentRow[]).map((r) => {
    const hasResponded = r.slot_responses.length > 0
    return {
      respondentId: r.id,
      userId: r.user_id,
      displayName: profileMap.get(r.user_id) || '(不明)',
      side: r.side,
      isRequired: r.is_required,
      hasResponded,
      responseCount: r.slot_responses.length,
      responses: r.slot_responses,
    }
  })

  const totalRespondents = enrichedRespondents.length
  const respondedCount = enrichedRespondents.filter((r) => r.hasResponded).length
  const unrespondedCount = totalRespondents - respondedCount

  // Per-slot summary
  const slotSummaries = (slots as SlotRow[]).map((s) => {
    const responses = s.slot_responses || []
    return {
      slotId: s.id,
      startAt: s.start_at,
      endAt: s.end_at,
      slotOrder: s.slot_order,
      availableCount: responses.filter((r) => r.response === 'available').length,
      unavailableButProceedCount: responses.filter((r) => r.response === 'unavailable_but_proceed').length,
      unavailableCount: responses.filter((r) => r.response === 'unavailable').length,
      totalResponses: responses.length,
    }
  })

  return {
    proposal,
    summary: {
      totalRespondents,
      respondedCount,
      unrespondedCount,
    },
    respondents: enrichedRespondents,
    slots: slotSummaries,
  }
}

// ── Google FreeBusy helpers ──────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_FREEBUSY_URL = 'https://www.googleapis.com/calendar/v3/freeBusy'
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000

interface BusyPeriod {
  start: string
  end: string
}

interface SuggestedSlot {
  startAt: string
  endAt: string
  dayOfWeek: number
  dateKey: string
}

async function getValidAccessToken(
  connection: { id: string; access_token: string; refresh_token: string | null; token_expires_at: string | null },
): Promise<string | null> {
  // Check expiry
  if (connection.token_expires_at) {
    const expiresAt = new Date(connection.token_expires_at).getTime()
    if (expiresAt - Date.now() > TOKEN_EXPIRY_BUFFER_MS) {
      return connection.access_token
    }
  } else {
    return connection.access_token
  }

  // Attempt refresh
  if (!connection.refresh_token) return null

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    // Cannot refresh without OAuth credentials — try the existing token anyway
    return connection.access_token
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) return null

  const data = await response.json() as { access_token: string; expires_in: number; refresh_token?: string }
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  // Persist refreshed token
  const supabase = getSupabaseClient()
  const updateData: Record<string, unknown> = {
    access_token: data.access_token,
    token_expires_at: newExpiresAt,
    last_refreshed_at: new Date().toISOString(),
    status: 'active',
  }
  if (data.refresh_token) {
    updateData.refresh_token = data.refresh_token
  }
  await supabase
    .from('integration_connections')
    .update(updateData)
    .eq('id', connection.id)

  return data.access_token
}

async function queryFreeBusy(accessToken: string, timeMin: string, timeMax: string): Promise<BusyPeriod[]> {
  const response = await fetch(GOOGLE_FREEBUSY_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      timeMin,
      timeMax,
      items: [{ id: 'primary' }],
    }),
  })

  if (!response.ok) {
    throw new Error(`Google FreeBusy API error (${response.status})`)
  }

  const data = await response.json() as { calendars?: Record<string, { busy: BusyPeriod[] }> }
  return data.calendars?.['primary']?.busy ?? []
}

function computeAvailableSlots(
  busyPeriods: BusyPeriod[],
  options: {
    startDate: string
    endDate: string
    durationMinutes: number
    businessHourStart: number
    businessHourEnd: number
  },
): SuggestedSlot[] {
  const { startDate, endDate, durationMinutes, businessHourStart, businessHourEnd } = options
  const stepMinutes = 30
  const maxResults = 100

  if (durationMinutes <= 0 || businessHourStart >= businessHourEnd) return []

  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return []

  const busyMs = busyPeriods
    .map((b) => ({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() }))
    .filter((b) => !isNaN(b.start) && !isNaN(b.end))
    .sort((a, b) => a.start - b.start)

  const results: SuggestedSlot[] = []
  const durationMs = durationMinutes * 60 * 1000
  const stepMs = stepMinutes * 60 * 1000

  const current = new Date(start)
  while (current <= end && results.length < maxResults) {
    const dayOfWeek = current.getDay()
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      const dayStart = new Date(current)
      dayStart.setHours(businessHourStart, 0, 0, 0)
      const dayEnd = new Date(current)
      dayEnd.setHours(businessHourEnd, 0, 0, 0)

      const dayStartMs = dayStart.getTime()
      const dayEndMs = dayEnd.getTime()
      const dateKey = toLocalDateOnly(current)

      const dayBusy = busyMs.filter((b) => b.start < dayEndMs && b.end > dayStartMs)

      let slotStart = dayStartMs
      while (slotStart + durationMs <= dayEndMs && results.length < maxResults) {
        const slotEnd = slotStart + durationMs
        const overlaps = dayBusy.some((b) => b.start < slotEnd && b.end > slotStart)
        if (!overlaps) {
          results.push({
            startAt: toDatetimeLocal(new Date(slotStart)),
            endAt: toDatetimeLocal(new Date(slotEnd)),
            dayOfWeek,
            dateKey,
          })
        }
        slotStart += stepMs
      }
    }
    current.setDate(current.getDate() + 1)
  }
  return results
}

function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3) return new Date(NaN)
  const [y, m, d] = parts
  return new Date(y, m - 1, d)
}

function toLocalDateOnly(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function toDatetimeLocal(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${y}-${m}-${d}T${h}:${min}`
}

interface IntegrationConnectionRow {
  id: string
  owner_id: string
  access_token: string
  refresh_token: string | null
  token_expires_at: string | null
}

export async function schedulingSuggestSlots(params: z.infer<typeof schedulingSuggestSchema>) {
  await checkAuth(params.spaceId, 'read', 'suggest_available_slots')

  const supabase = getSupabaseClient()

  // Validate date range
  const daysDiff = (new Date(params.endDate).getTime() - new Date(params.startDate).getTime()) / (1000 * 60 * 60 * 24)
  if (daysDiff < 0) throw new Error('startDate は endDate 以前にしてください')
  if (daysDiff > 30) throw new Error('最大30日間まで指定できます')

  // Security: Verify requested userIds are members of this space
  const { data: spaceMembers } = await supabase
    .from('space_memberships')
    .select('user_id')
    .eq('space_id', params.spaceId)
    .in('user_id', params.userIds)

  const allowedUserIds = (spaceMembers || []).map((m: { user_id: string }) => m.user_id)
  const rejectedUserIds = params.userIds.filter((id) => !allowedUserIds.includes(id))

  if (allowedUserIds.length === 0) {
    throw new Error('指定されたユーザーはこのスペースのメンバーではありません')
  }

  // Fetch Google Calendar connections only for verified space members
  const { data: connections } = await supabase
    .from('integration_connections')
    .select('id, owner_id, access_token, refresh_token, token_expires_at')
    .eq('provider', 'google_calendar')
    .eq('owner_type', 'user')
    .in('owner_id', allowedUserIds)
    .eq('status', 'active')

  if (!connections || connections.length === 0) {
    return {
      slots: [],
      connectedUserIds: [],
      disconnectedUserIds: allowedUserIds,
      rejectedUserIds,
      message: '対象ユーザーにGoogleカレンダー接続がありません。Web UIからカレンダー連携を設定してください。',
    }
  }

  const typedConnections = connections as IntegrationConnectionRow[]
  const connectedUserIds = typedConnections.map((c) => c.owner_id)
  const disconnectedUserIds = allowedUserIds.filter((id) => !connectedUserIds.includes(id))

  // Query FreeBusy for each connected user (in parallel)
  // Collect per-user results to distinguish success vs failure
  const startDt = new Date(params.startDate + 'T00:00:00')
  const endDt = new Date(params.endDate + 'T23:59:59')
  const timeMin = startDt.toISOString()
  const timeMax = endDt.toISOString()

  const results = await Promise.allSettled(
    typedConnections.map(async (conn): Promise<{ userId: string; busy: BusyPeriod[] }> => {
      const token = await getValidAccessToken(conn)
      if (!token) throw new Error(`Token unavailable for user ${conn.owner_id}`)
      const busy = await queryFreeBusy(token, timeMin, timeMax)
      return { userId: conn.owner_id, busy }
    })
  )

  const allBusy: BusyPeriod[] = []
  const successUserIds: string[] = []
  const failedUserIds: string[] = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allBusy.push(...result.value.busy)
      successUserIds.push(result.value.userId)
    } else {
      console.error('[MCP:SuggestSlots] FreeBusy error:', result.reason)
      // Extract userId from the error or find it via connection mapping
    }
  }

  // Determine failed users (connected but FreeBusy query failed)
  for (const conn of typedConnections) {
    if (!successUserIds.includes(conn.owner_id)) {
      failedUserIds.push(conn.owner_id)
    }
  }

  // Guard: if all FreeBusy calls failed, don't return unvalidated slots
  if (successUserIds.length === 0) {
    return {
      slots: [],
      slotCount: 0,
      connectedUserIds: [],
      disconnectedUserIds,
      failedUserIds,
      rejectedUserIds,
      message: '全ユーザーのカレンダー取得に失敗しました。トークンが期限切れの可能性があります。Web UIからカレンダー連携を再設定してください。',
    }
  }

  // Merge and compute available slots across successful users' busy periods
  const slots = computeAvailableSlots(allBusy, {
    startDate: params.startDate,
    endDate: params.endDate,
    durationMinutes: params.durationMinutes,
    businessHourStart: params.businessHourStart,
    businessHourEnd: params.businessHourEnd,
  })

  const messages: string[] = []
  if (rejectedUserIds.length > 0) {
    messages.push(`${rejectedUserIds.length}名はスペースメンバーでないため除外しました。`)
  }
  if (disconnectedUserIds.length > 0) {
    messages.push(`${disconnectedUserIds.length}名はGoogleカレンダー未接続です。`)
  }
  if (failedUserIds.length > 0) {
    messages.push(`${failedUserIds.length}名のカレンダー取得に失敗しました（空き時間に含まれていません）。`)
  }

  return {
    slots,
    slotCount: slots.length,
    connectedUserIds: successUserIds,
    disconnectedUserIds,
    failedUserIds,
    rejectedUserIds,
    message: messages.length > 0 ? messages.join(' ') : undefined,
  }
}

export async function schedulingSendReminder(params: z.infer<typeof schedulingReminderSchema>) {
  await checkAuth(params.spaceId, 'write', 'send_proposal_reminder', params.proposalId)

  const supabase = getSupabaseClient()

  // Fetch proposal
  const { data: proposal, error: proposalError } = await supabase
    .from('scheduling_proposals')
    .select('id, title, status, org_id, space_id, expires_at')
    .eq('id', params.proposalId)
    .eq('space_id', params.spaceId)
    .single()

  if (proposalError || !proposal) throw new Error('提案が見つかりません')
  if (proposal.status !== 'open') throw new Error(`この提案は現在「${proposal.status}」のため、リマインドできません`)

  // Find respondents who haven't responded to any slot
  const { data: respondents, error: respondentError } = await supabase
    .from('proposal_respondents')
    .select('id, user_id, slot_responses(id)')
    .eq('proposal_id', params.proposalId)

  if (respondentError) throw new Error(`回答者情報の取得に失敗しました: ${respondentError.message}`)

  interface RespondentWithResponses {
    id: string
    user_id: string
    slot_responses: Array<{ id: string }>
  }

  const unrespondedUsers = (respondents as RespondentWithResponses[])
    .filter((r) => r.slot_responses.length === 0)
    .map((r) => r.user_id)

  if (unrespondedUsers.length === 0) {
    return { ok: true, sentCount: 0, message: '全員が回答済みです。リマインドは送信されませんでした。' }
  }

  // Insert notifications for each unresponded user (with dedup)
  const now = new Date().toISOString()
  const notificationRows = unrespondedUsers.map((userId) => ({
    org_id: proposal.org_id,
    space_id: proposal.space_id,
    to_user_id: userId,
    channel: 'in_app',
    type: 'scheduling_reminder',
    dedupe_key: `scheduling_reminder:${params.proposalId}:${userId}:manual`,
    payload: {
      proposalId: params.proposalId,
      title: proposal.title,
      reminderType: 'manual',
      expiresAt: proposal.expires_at,
      message: `日程調整「${proposal.title}」への回答をお願いします。`,
    },
    created_at: now,
  }))

  // Upsert to handle dedup (ignore if already sent)
  const { error: insertError } = await supabase
    .from('notifications')
    .upsert(notificationRows, { onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })

  if (insertError) throw new Error(`リマインド送信に失敗しました: ${insertError.message}`)

  // Also log to scheduling_reminder_log for tracking
  const logRows = unrespondedUsers.map((userId) => ({
    proposal_id: params.proposalId,
    reminder_type: 'manual_reminder',
    target_user_id: userId,
    sent_at: now,
  }))

  // Best-effort log (don't fail if log insert fails)
  try {
    await supabase
      .from('scheduling_reminder_log')
      .upsert(logRows, { onConflict: 'proposal_id,reminder_type,target_user_id', ignoreDuplicates: true })
  } catch {
    // ignore log errors
  }

  return { ok: true, sentCount: unrespondedUsers.length, unrespondedUserIds: unrespondedUsers }
}

// Tool definitions for MCP
export const schedulingTools = [
  {
    name: 'list_scheduling_proposals',
    description: '日程調整提案一覧。statusフィルタ可',
    inputSchema: schedulingListSchema,
    handler: schedulingList,
  },
  {
    name: 'create_scheduling_proposal',
    description: '日程調整提案作成。候補2-5個+client回答者1名以上必須',
    inputSchema: schedulingCreateSchema,
    handler: schedulingCreate,
  },
  {
    name: 'respond_to_proposal',
    description: '日程調整スロット回答。available/unavailable_but_proceed/unavailable',
    inputSchema: schedulingRespondSchema,
    handler: schedulingRespond,
  },
  {
    name: 'confirm_proposal_slot',
    description: 'スロット確定→会議作成。全必須回答者の参加可/欠席OK要',
    inputSchema: schedulingConfirmSchema,
    handler: schedulingConfirm,
  },
  {
    name: 'cancel_scheduling_proposal',
    description: '提案キャンセル/期限延長。action=extend時newExpiresAt必須',
    inputSchema: schedulingCancelSchema,
    handler: schedulingCancel,
  },
  {
    name: 'get_proposal_responses',
    description: '回答状況取得。回答済/未回答+スロット集計',
    inputSchema: schedulingResponsesSchema,
    handler: schedulingGetResponses,
  },
  {
    name: 'suggest_available_slots',
    description: 'GoogleCal空き時間から候補提案。全員の予定考慮',
    inputSchema: schedulingSuggestSchema,
    handler: schedulingSuggestSlots,
  },
  {
    name: 'send_proposal_reminder',
    description: '未回答者にリマインド通知送信',
    inputSchema: schedulingReminderSchema,
    handler: schedulingSendReminder,
  },
]
