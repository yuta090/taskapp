import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config } from '../config.js'
import { checkAuth, checkAuthOrg } from '../auth/helpers.js'

// ActivityLog type
export interface ActivityLog {
  id: string
  occurred_at: string
  actor_id: string | null
  actor_type: string
  actor_service: string | null
  request_id: string | null
  session_id: string | null
  entity_schema: string
  entity_table: string
  entity_id: string | null
  entity_key: string | null
  entity_display: string | null
  action: string
  reason: string | null
  status: string
  changed_fields: string[] | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  payload: Record<string, unknown>
  related_table: string | null
  related_id: string | null
  organization_id: string | null
  space_id: string | null
  is_deleted: boolean
}

// Helper: get orgId from spaceId
async function getOrgId(spaceId: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  if (error || !data) throw new Error('スペースが見つかりません')
  return data.org_id
}

// Schemas
export const activityLogSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  entityTable: z.string().describe('対象テーブル名 (tasks, milestones, etc.)'),
  entityId: z.string().uuid().describe('対象レコードのUUID'),
  action: z.string().describe('アクション (insert, update, delete, etc.)'),
  actorType: z.enum(['user', 'system', 'ai', 'service']).default('ai').describe('アクタータイプ'),
  actorService: z.string().optional().describe('サービス名 (MCP/Claude/GPT等)'),
  requestId: z.string().uuid().optional().describe('リクエストID（相関用）'),
  sessionId: z.string().uuid().optional().describe('セッションID（相関用）'),
  entityDisplay: z.string().optional().describe('表示用の名前'),
  reason: z.string().optional().describe('変更理由/AIの意図'),
  status: z.enum(['ok', 'error', 'warning']).default('ok').describe('ステータス'),
  changedFields: z.array(z.string()).optional().describe('変更されたフィールド名'),
  beforeData: z.record(z.unknown()).optional().describe('変更前データ'),
  afterData: z.record(z.unknown()).optional().describe('変更後データ'),
  payload: z.record(z.unknown()).optional().describe('追加メタ情報'),
})

export const activitySearchSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  entityTable: z.string().optional().describe('テーブル名でフィルタ'),
  entityId: z.string().uuid().optional().describe('エンティティIDでフィルタ'),
  actorId: z.string().uuid().optional().describe('アクターIDでフィルタ'),
  action: z.string().optional().describe('アクションでフィルタ'),
  from: z.string().optional().describe('開始日時 (ISO8601)'),
  to: z.string().optional().describe('終了日時 (ISO8601)'),
  sessionId: z.string().uuid().optional().describe('セッションIDでフィルタ'),
  limit: z.number().min(1).max(500).default(100).describe('取得件数'),
})

export const activityEntityHistorySchema = z.object({
  entityTable: z.string().describe('テーブル名'),
  entityId: z.string().uuid().describe('エンティティID'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

// Tool implementations
export async function activityLog(params: z.infer<typeof activityLogSchema>): Promise<{ id: string }> {
  await checkAuth(params.spaceId, 'write', 'activity_log', 'activity', params.entityId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data, error } = await supabase
    .from('activity_log')
    .insert({
      actor_id: config.actorId,
      actor_type: params.actorType,
      actor_service: params.actorService || 'MCP',
      request_id: params.requestId || null,
      session_id: params.sessionId || null,
      entity_table: params.entityTable,
      entity_id: params.entityId,
      entity_display: params.entityDisplay || null,
      action: params.action,
      reason: params.reason || null,
      status: params.status,
      changed_fields: params.changedFields || null,
      before_data: params.beforeData || null,
      after_data: params.afterData || null,
      payload: params.payload || {},
      organization_id: orgId,
      space_id: params.spaceId,
    })
    .select('id')
    .single()

  if (error) throw new Error('アクティビティログの記録に失敗しました: ' + error.message)
  return { id: data.id }
}

export async function activitySearch(params: z.infer<typeof activitySearchSchema>): Promise<ActivityLog[]> {
  await checkAuth(params.spaceId, 'read', 'activity_search', 'activity')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  let query = supabase
    .from('activity_log')
    .select('*')
    .eq('organization_id', orgId)
    .eq('space_id', params.spaceId)
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false })
    .limit(params.limit)

  if (params.entityTable) query = query.eq('entity_table', params.entityTable)
  if (params.entityId) query = query.eq('entity_id', params.entityId)
  if (params.actorId) query = query.eq('actor_id', params.actorId)
  if (params.action) query = query.eq('action', params.action)
  if (params.sessionId) query = query.eq('session_id', params.sessionId)
  if (params.from) query = query.gte('occurred_at', params.from)
  if (params.to) query = query.lte('occurred_at', params.to)

  const { data, error } = await query

  if (error) throw new Error('アクティビティログの検索に失敗しました: ' + error.message)
  return (data || []) as ActivityLog[]
}

export async function activityEntityHistory(params: z.infer<typeof activityEntityHistorySchema>): Promise<ActivityLog[]> {
  const { ctx } = await checkAuthOrg('read', 'activity_entity_history')
  const supabase = getSupabaseClient()
  const orgId = ctx.orgId

  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('organization_id', orgId)
    .eq('entity_table', params.entityTable)
    .eq('entity_id', params.entityId)
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false })
    .limit(params.limit)

  if (error) throw new Error('エンティティ履歴の取得に失敗しました: ' + error.message)
  return (data || []) as ActivityLog[]
}

// Tool definitions for MCP
export const activityTools = [
  {
    name: 'activity_log',
    description: 'アクティビティログ記録(AI操作追跡)',
    inputSchema: activityLogSchema,
    handler: activityLog,
  },
  {
    name: 'activity_search',
    description: 'アクティビティログ検索。table/actor/action/期間フィルタ可',
    inputSchema: activitySearchSchema,
    handler: activitySearch,
  },
  {
    name: 'activity_entity_history',
    description: 'エンティティ変更履歴取得(デバッグ用)',
    inputSchema: activityEntityHistorySchema,
    handler: activityEntityHistory,
  },
]
