import { z } from 'zod'
import { getSupabaseClient, Space } from '../supabase/client.js'
import { config } from '../config.js'

// Schemas
export const spaceCreateSchema = z.object({
  name: z.string().min(1).describe('プロジェクト名'),
  type: z.enum(['project', 'personal']).default('project').describe('タイプ: project=共有, personal=個人'),
})

export const spaceUpdateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID'),
  name: z.string().min(1).optional().describe('新しいプロジェクト名'),
})

export const spaceListSchema = z.object({
  type: z.enum(['project', 'personal']).optional().describe('タイプでフィルタ'),
})

export const spaceGetSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID'),
})

// Tool implementations
export async function spaceCreate(params: z.infer<typeof spaceCreateSchema>): Promise<Space> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  const { data, error } = await supabase
    .from('spaces')
    .insert({
      org_id: orgId,
      name: params.name,
      type: params.type,
      owner_user_id: params.type === 'personal' ? config.actorId : null,
    })
    .select('*')
    .single()

  if (error) throw new Error('プロジェクトの作成に失敗しました: ' + error.message)
  return data as Space
}

export async function spaceUpdate(params: z.infer<typeof spaceUpdateSchema>): Promise<Space> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  const updateData: Record<string, unknown> = {}
  if (params.name !== undefined) updateData.name = params.name

  if (Object.keys(updateData).length === 0) {
    throw new Error('更新するフィールドがありません')
  }

  const { data, error } = await supabase
    .from('spaces')
    .update(updateData)
    .eq('id', params.spaceId)
    .eq('org_id', orgId)
    .select('*')
    .single()

  if (error) throw new Error('プロジェクトの更新に失敗しました: ' + error.message)
  return data as Space
}

export async function spaceList(params: z.infer<typeof spaceListSchema>): Promise<Space[]> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  let query = supabase
    .from('spaces')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (params.type) {
    query = query.eq('type', params.type)
  }

  const { data, error } = await query

  if (error) throw new Error('プロジェクト一覧の取得に失敗しました: ' + error.message)
  return (data || []) as Space[]
}

export async function spaceGet(params: z.infer<typeof spaceGetSchema>): Promise<Space> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId

  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .eq('id', params.spaceId)
    .eq('org_id', orgId)
    .single()

  if (error) throw new Error('プロジェクトが見つかりません: ' + error.message)
  return data as Space
}

// Tool definitions for MCP
export const spaceTools = [
  {
    name: 'space_create',
    description: 'プロジェクト（スペース）を新規作成します。',
    inputSchema: spaceCreateSchema,
    handler: spaceCreate,
  },
  {
    name: 'space_update',
    description: 'プロジェクト名を更新します。',
    inputSchema: spaceUpdateSchema,
    handler: spaceUpdate,
  },
  {
    name: 'space_list',
    description: 'プロジェクト一覧を取得します。typeでフィルタ可能です。',
    inputSchema: spaceListSchema,
    handler: spaceList,
  },
  {
    name: 'space_get',
    description: 'プロジェクトの詳細を取得します。',
    inputSchema: spaceGetSchema,
    handler: spaceGet,
  },
]
