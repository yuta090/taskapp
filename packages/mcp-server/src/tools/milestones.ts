import { z } from 'zod'
import { getSupabaseClient } from '../supabase/client.js'
import { config } from '../config.js'

// Milestone type
export interface Milestone {
  id: string
  org_id: string
  space_id: string
  name: string
  due_date: string | null
  order_key: number
  created_at: string
  updated_at: string
}

// Schemas
export const milestoneCreateSchema = z.object({
  name: z.string().min(1).describe('マイルストーン名'),
  dueDate: z.string().optional().describe('期限日 (YYYY-MM-DD)'),
})

export const milestoneUpdateSchema = z.object({
  milestoneId: z.string().uuid().describe('マイルストーンUUID'),
  name: z.string().min(1).optional().describe('新しいマイルストーン名'),
  dueDate: z.string().optional().describe('新しい期限日 (YYYY-MM-DD、空文字で削除)'),
  orderKey: z.number().optional().describe('表示順序キー'),
})

export const milestoneListSchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUID (省略時はデフォルト)'),
})

export const milestoneGetSchema = z.object({
  milestoneId: z.string().uuid().describe('マイルストーンUUID'),
})

export const milestoneDeleteSchema = z.object({
  milestoneId: z.string().uuid().describe('削除するマイルストーンのUUID'),
})

// Tool implementations
export async function milestoneCreate(params: z.infer<typeof milestoneCreateSchema>): Promise<Milestone> {
  const supabase = getSupabaseClient()
  const spaceId = config.spaceId
  const orgId = config.orgId

  const { data, error } = await supabase
    .from('milestones')
    .insert({
      org_id: orgId,
      space_id: spaceId,
      name: params.name,
      due_date: params.dueDate || null,
      order_key: Math.floor(Date.now() / 1000),
    })
    .select('*')
    .single()

  if (error) throw new Error('マイルストーンの作成に失敗しました: ' + error.message)
  return data as Milestone
}

export async function milestoneUpdate(params: z.infer<typeof milestoneUpdateSchema>): Promise<Milestone> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  const updateData: Record<string, unknown> = {}
  if (params.name !== undefined) updateData.name = params.name
  if (params.dueDate !== undefined) updateData.due_date = params.dueDate || null
  if (params.orderKey !== undefined) updateData.order_key = params.orderKey

  if (Object.keys(updateData).length === 0) {
    throw new Error('更新するフィールドがありません')
  }

  updateData.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('milestones')
    .update(updateData)
    .eq('id', params.milestoneId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .select('*')
    .single()

  if (error) throw new Error('マイルストーンの更新に失敗しました: ' + error.message)
  return data as Milestone
}

export async function milestoneList(params: z.infer<typeof milestoneListSchema>): Promise<Milestone[]> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = params.spaceId || config.spaceId

  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .order('order_key', { ascending: true })

  if (error) throw new Error('マイルストーン一覧の取得に失敗しました: ' + error.message)
  return (data || []) as Milestone[]
}

export async function milestoneGet(params: z.infer<typeof milestoneGetSchema>): Promise<Milestone> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  const { data, error } = await supabase
    .from('milestones')
    .select('*')
    .eq('id', params.milestoneId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (error) throw new Error('マイルストーンが見つかりません: ' + error.message)
  return data as Milestone
}

export async function milestoneDelete(params: z.infer<typeof milestoneDeleteSchema>): Promise<{ success: boolean; milestoneId: string }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  const { error } = await supabase
    .from('milestones')
    .delete()
    .eq('id', params.milestoneId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)

  if (error) throw new Error('マイルストーンの削除に失敗しました: ' + error.message)
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
