import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { checkAuth, checkAuthOrg } from '../auth/helpers.js'
import { ToolUserError } from '../errors.js'
import { notFoundOr } from '../lib/dbErrors.js'

/**
 * activity_search / activity_entity_history は、データの変更の控え change_log を読む。
 * change_log は DB トリガーが主要な表の追加・更新・削除を全部記録する追記専用の表
 * （誰が・どの経路で・何を・いつ。migration 20260926091821_change_log.sql）。
 *
 * CLI から見せるのは、プロジェクトに属する次の表の行だけ。組織の請求・APIキー・招待・
 * プロフィールなどの控えは運営画面だけで見る。
 */
export const ALLOWED_ACTIVITY_ENTITY_TABLES = new Set([
  'tasks',
  'milestones',
  'meetings',
  'wiki_pages',
  'reviews',
  'task_comments',
  'files',
  'scheduling_proposals',
])

/** 操作の種類（CLI の言葉）と change_log.op の対応 */
const ACTION_TO_OP: Record<string, 'I' | 'U' | 'D'> = {
  insert: 'I',
  update: 'U',
  delete: 'D',
  i: 'I',
  u: 'U',
  d: 'D',
}
const OP_TO_ACTION = { I: 'insert', U: 'update', D: 'delete' } as const

// change_log の1行（+ 読みやすさのための action）
export interface ChangeLogEntry {
  id: number
  occurred_at: string
  txid: number
  table_name: string
  op: 'I' | 'U' | 'D'
  action: 'insert' | 'update' | 'delete'
  row_pk: Record<string, unknown>
  org_id: string | null
  space_id: string | null
  actor_kind: 'user' | 'api_key' | 'service' | 'system'
  actor_user_id: string | null
  api_key_id: string | null
  channel: string
  request_id: string | null
  changed_columns: string[] | null
  old_row: Record<string, unknown> | null
  new_row: Record<string, unknown> | null
}

// Helper: get orgId from spaceId
async function getOrgId(spaceId: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  // 0件（PGRST116）だけ「見つかりません」。それ以外(権限エラー等)は生の文言を出さない一般の
  // エラーのままだが、どちらも元のDBエラーを cause に残す(運営画面の利用記録から追える)
  if (error) throw notFoundOr(error, 'activity/getOrgId', 'スペースが見つかりません', 'スペースの取得に失敗しました')
  if (!data) throw new ToolUserError('スペースが見つかりません', 404)
  return data.org_id
}

function assertAllowedTable(table: string): void {
  if (!ALLOWED_ACTIVITY_ENTITY_TABLES.has(table)) {
    throw new ToolUserError(
      `entityTable "${table}" の履歴は見られません（見られる表: ${[...ALLOWED_ACTIVITY_ENTITY_TABLES].join(', ')}）`,
      400,
    )
  }
}

function toOp(action: string): 'I' | 'U' | 'D' {
  const op = ACTION_TO_OP[action.toLowerCase()]
  if (!op) throw new ToolUserError(`action は insert / update / delete のどれかを指定してください（受け取った値: ${action}）`, 400)
  return op
}

function withAction(rows: unknown[] | null): ChangeLogEntry[] {
  return ((rows || []) as Omit<ChangeLogEntry, 'action'>[]).map(row => ({
    ...row,
    action: OP_TO_ACTION[row.op],
  }))
}

// Schemas
export const activitySearchSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  entityTable: z.string().optional().describe(`テーブル名でフィルタ（${[...ALLOWED_ACTIVITY_ENTITY_TABLES].join(', ')}）`),
  entityId: z.string().uuid().optional().describe('行のIDでフィルタ'),
  actorId: z.string().uuid().optional().describe('操作した人のIDでフィルタ'),
  action: z.string().optional().describe('操作の種類でフィルタ（insert / update / delete）'),
  from: z.string().optional().describe('開始日時 (ISO8601)'),
  to: z.string().optional().describe('終了日時 (ISO8601)'),
  limit: z.number().min(1).max(500).default(100).describe('取得件数'),
})

export const activityEntityHistorySchema = z.object({
  entityTable: z.string().describe(`テーブル名（${[...ALLOWED_ACTIVITY_ENTITY_TABLES].join(', ')}）`),
  entityId: z.string().uuid().describe('行のID'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

// Tool implementations
export async function activitySearch(params: z.infer<typeof activitySearchSchema>): Promise<ChangeLogEntry[]> {
  await checkAuth(params.spaceId, 'read', 'activity_search', 'activity')
  if (params.entityTable) assertAllowedTable(params.entityTable)
  const op = params.action ? toOp(params.action) : null

  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  let query = supabase
    .from('change_log')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .in('table_name', [...ALLOWED_ACTIVITY_ENTITY_TABLES])

  if (params.entityTable) query = query.eq('table_name', params.entityTable)
  if (params.entityId) query = query.eq('row_pk->>id', params.entityId)
  if (params.actorId) query = query.eq('actor_user_id', params.actorId)
  if (op) query = query.eq('op', op)
  if (params.from) query = query.gte('occurred_at', params.from)
  if (params.to) query = query.lte('occurred_at', params.to)

  const { data, error } = await query.order('id', { ascending: false }).limit(params.limit)

  if (error) {
    console.error('activity_search failed:', error.code, error.message)
    // 文言は変えない。cause に元のDBエラーを残し、運営画面の利用記録から原因を追えるようにする
    throw new Error('アクティビティログの検索に失敗しました', { cause: error })
  }
  return withAction(data)
}

export async function activityEntityHistory(params: z.infer<typeof activityEntityHistorySchema>): Promise<ChangeLogEntry[]> {
  const { ctx } = await checkAuthOrg('read', 'activity_entity_history')
  assertAllowedTable(params.entityTable)
  const supabase = getSupabaseClient()

  let query = supabase
    .from('change_log')
    .select('*')
    .eq('org_id', ctx.orgId)
    .eq('table_name', params.entityTable)
    .eq('row_pk->>id', params.entityId)

  // 鍵の見られるプロジェクトが決まっていれば、そこに絞る
  if (ctx.allowedSpaceIds) query = query.in('space_id', ctx.allowedSpaceIds)

  const { data, error } = await query.order('id', { ascending: false }).limit(params.limit)

  if (error) {
    console.error('activity_entity_history failed:', error.code, error.message)
    throw new Error('エンティティ履歴の取得に失敗しました', { cause: error })
  }
  return withAction(data)
}

// Tool definitions for MCP
// activity_log（手書きの記録）は廃止した。変更は DB トリガーが change_log に自動で残す
export const activityTools = [
  {
    name: 'activity_search',
    description: 'データの変更履歴（誰が・いつ・どの経路で・何を変えたか）を検索。表/行/操作した人/操作の種類/期間で絞れる',
    inputSchema: activitySearchSchema,
    handler: activitySearch,
  },
  {
    name: 'activity_entity_history',
    description: '1つの行（タスク・Wikiページ等）の変更履歴を新しい順に取得',
    inputSchema: activityEntityHistorySchema,
    handler: activityEntityHistory,
  },
]
