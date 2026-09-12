import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { checkAuth } from '../auth/helpers.js'
import { notFoundOr } from '../lib/dbErrors.js'

// Milestone type
export interface Milestone {
  id: string
  org_id: string
  space_id: string
  name: string
  due_date: string | null
  order_key: number
  created_at: string
}

// Helper: get orgId from spaceId
async function getOrgId(spaceId: string): Promise<string> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single()
  if (error || !data) throw new Error('スペースが見つかりません')
  return data.org_id
}

// Schemas
export const milestoneCreateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  name: z.string().min(1).describe('マイルストーン名'),
  dueDate: z.string().optional().describe('期限日 (YYYY-MM-DD)'),
})

export const milestoneUpdateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  milestoneId: z.string().uuid().describe('マイルストーンUUID'),
  name: z.string().min(1).optional().describe('新しいマイルストーン名'),
  dueDate: z.string().optional().describe('新しい期限日 (YYYY-MM-DD、空文字で削除)'),
  orderKey: z.number().optional().describe('表示順序キー'),
})

export const milestoneListSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
})

export const milestoneGetSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  milestoneId: z.string().uuid().describe('マイルストーンUUID'),
})

export const milestoneDeleteSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  milestoneId: z.string().uuid().describe('削除するマイルストーンのUUID'),
})

// Tool implementations
export async function milestoneCreate(params: z.infer<typeof milestoneCreateSchema>): Promise<Milestone> {
  await checkAuth(params.spaceId, 'write', 'milestone_create', 'milestone')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data, error } = await supabase
    .from('milestones')
    .insert({
      org_id: orgId,
      space_id: params.spaceId,
      name: params.name,
      due_date: params.dueDate || null,
      // 画面（useMilestones.ts・TaskCreateSheet.tsx）と単位を揃える（ミリ秒）。
      // ここだけ秒にすると、あとから CLI/MCP で作ったマイルストーンの order_key が
      // 画面で先に作ったものより小さくなり、並び順で前に出てしまう
      order_key: Date.now(),
    })
    .select('*')
    .single()

  if (error) {
    console.error('milestone_create failed:', error.code, error.message)
    throw new Error('マイルストーンの作成に失敗しました')
  }
  return data as Milestone
}

export async function milestoneUpdate(params: z.infer<typeof milestoneUpdateSchema>): Promise<Milestone> {
  await checkAuth(params.spaceId, 'write', 'milestone_update', 'milestone', params.milestoneId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const updateData: Record<string, unknown> = {}
  if (params.name !== undefined) updateData.name = params.name
  if (params.dueDate !== undefined) updateData.due_date = params.dueDate || null
  if (params.orderKey !== undefined) updateData.order_key = params.orderKey

  if (Object.keys(updateData).length === 0) {
    throw new Error('更新するフィールドがありません')
  }

  // milestones テーブルに updated_at 列は無い（schema.sql: id/org_id/space_id/name/due_date/order_key/created_at）。
  // 送ると PostgREST がスキーマ不一致で拒否し、更新が一度も成功しない状態だった

  const { data, error } = await supabase
    .from('milestones')
    .update(updateData)
    .eq('id', params.milestoneId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .select('*')
    .single()

  if (error) throw notFoundOr(error, 'milestone_update', 'マイルストーンが見つかりません', 'マイルストーンの更新に失敗しました')
  return data as Milestone
}

export async function milestoneList(params: z.infer<typeof milestoneListSchema>): Promise<Milestone[]> {
  await checkAuth(params.spaceId, 'read', 'milestone_list', 'milestone')
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .order('order_key', { ascending: true })

  if (error) {
    console.error('milestone_list failed:', error.code, error.message)
    throw new Error('マイルストーン一覧の取得に失敗しました')
  }
  return (data || []) as Milestone[]
}

export async function milestoneGet(params: z.infer<typeof milestoneGetSchema>): Promise<Milestone> {
  await checkAuth(params.spaceId, 'read', 'milestone_get', 'milestone', params.milestoneId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', params.milestoneId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)
    .single()

  if (error) throw notFoundOr(error, 'milestone_get', 'マイルストーンが見つかりません', 'マイルストーンの取得に失敗しました')
  return data as Milestone
}

export async function milestoneDelete(params: z.infer<typeof milestoneDeleteSchema>): Promise<{ success: boolean; milestoneId: string }> {
  await checkAuth(params.spaceId, 'delete', 'milestone_delete', 'milestone', params.milestoneId)
  const supabase = getSupabaseClient()
  const orgId = await getOrgId(params.spaceId)

  const { error } = await supabase
    .from('milestones')
    .delete()
    .eq('id', params.milestoneId)
    .eq('org_id', orgId)
    .eq('space_id', params.spaceId)

  if (error) {
    console.error('milestone_delete failed:', error.code, error.message)
    throw new Error('マイルストーンの削除に失敗しました')
  }
  return { success: true, milestoneId: params.milestoneId }
}

// Tool definitions for MCP
export const milestoneTools = [
  {
    name: 'milestone_create',
    description: 'マイルストーン新規作成',
    inputSchema: milestoneCreateSchema,
    handler: milestoneCreate,
  },
  {
    name: 'milestone_update',
    description: 'マイルストーン部分更新',
    inputSchema: milestoneUpdateSchema,
    handler: milestoneUpdate,
  },
  {
    name: 'milestone_list',
    description: 'マイルストーン一覧取得(order_key順)',
    inputSchema: milestoneListSchema,
    handler: milestoneList,
  },
  {
    name: 'milestone_get',
    description: 'マイルストーン詳細取得',
    inputSchema: milestoneGetSchema,
    handler: milestoneGet,
  },
  {
    name: 'milestone_delete',
    description: '【破壊的】マイルストーン削除。紐づくタスクのmilestone_id→null',
    inputSchema: milestoneDeleteSchema,
    handler: milestoneDelete,
  },
]
