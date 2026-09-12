import { z } from 'zod'
import { getSupabaseClient, Space } from '../supabase/client.js'
import { config } from '../config.js'
import { checkAuth, checkAuthOrg } from '../auth/helpers.js'
import { authorizeAndLog } from '../auth/index.js'
import { notFoundOr, hideDbError } from '../lib/dbErrors.js'

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
  const { ctx } = await checkAuthOrg('write', 'space_create')
  const supabase = getSupabaseClient()
  const orgId = ctx.orgId

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

  if (error) throw hideDbError(error, 'space_create', 'プロジェクトの作成に失敗しました')
  return data as Space
}

export async function spaceUpdate(params: z.infer<typeof spaceUpdateSchema>): Promise<Space> {
  await checkAuth(params.spaceId, 'write', 'space_update', 'space', params.spaceId)
  const supabase = getSupabaseClient()

  const { data: spaceRow, error: spaceError } = await supabase.from('spaces').select('org_id').eq('id', params.spaceId).single()
  if (spaceError || !spaceRow) throw new Error('スペースが見つかりません')
  const orgId = spaceRow.org_id

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

  if (error) throw hideDbError(error, 'space_update', 'プロジェクトの更新に失敗しました')
  return data as Space
}

export async function spaceList(params: z.infer<typeof spaceListSchema>): Promise<Space[]> {
  const ctx = (await import('../config.js')).getAuthContext()
  const supabase = getSupabaseClient()

  // scope=space（プロジェクト設定で作った鍵）: 使えるのはそのプロジェクトだけなので、その1件を返す。
  // 以前はここで断っていて、画面の案内どおり `agentpm space list` で接続を確かめると必ず失敗していた。
  // メンバーかどうか・読み取りが許されているかは、ほかの操作と同じ権限確認(checkAuth)で見る
  if (ctx.scope === 'space' && ctx.keyId !== 'dev-key') {
    if (!ctx.spaceId) {
      throw new Error('権限エラー: This API key is not bound to a space')
    }
    await checkAuth(ctx.spaceId, 'read', 'space_list', 'space', ctx.spaceId)
    let own = supabase.from('spaces').select('*').eq('id', ctx.spaceId).eq('org_id', ctx.orgId)
    if (params.type) own = own.eq('type', params.type)
    const { data, error } = await own
    if (error) throw hideDbError(error, 'space_list', 'プロジェクト一覧の取得に失敗しました')
    return (data || []) as Space[]
  }

  // scope=user（個人用の鍵）: 選んだプロジェクトのうち、今もメンバーで読み取りが許されるものだけを返す。
  // ほかの道具と同じ権限確認(mcp_authorize)をプロジェクトごとに通すので、役割が後から相手先に変わった・
  // プロジェクトから外れた鍵にも追従する。個人用の鍵は組織をまたげるので、鍵の組織では絞らない
  if (ctx.scope === 'user' && ctx.keyId !== 'dev-key') {
    if (!ctx.userId) {
      throw new Error('権限エラー: API key owner is not set')
    }
    const { data: memberRows, error: memberError } = await supabase
      .from('space_memberships')
      .select('space_id')
      .eq('user_id', ctx.userId)
    if (memberError) throw hideDbError(memberError, 'space_list (space_memberships)', 'プロジェクト一覧の取得に失敗しました')

    const allowedIds = ctx.allowedSpaceIds
    const candidateIds = (memberRows || [])
      .map((m) => m.space_id as string)
      .filter((id) => !allowedIds || allowedIds.includes(id))
    const permitted: string[] = []
    for (const spaceId of candidateIds) {
      const result = await authorizeAndLog({
        ctx,
        spaceId,
        action: 'read',
        toolName: 'space_list',
        resourceType: 'space',
        resourceId: spaceId,
      })
      if (result.allowed) permitted.push(spaceId)
    }
    if (permitted.length === 0) return []

    let mine = supabase.from('spaces').select('*').in('id', permitted).order('created_at', { ascending: false })
    if (params.type) mine = mine.eq('type', params.type)
    const { data, error } = await mine
    if (error) throw hideDbError(error, 'space_list (user)', 'プロジェクト一覧の取得に失敗しました')
    return (data || []) as Space[]
  }

  // scope=org: 組織のプロジェクトを全部返す（org 鍵を発行する経路は無い）
  if (ctx.scope !== 'org' && ctx.keyId !== 'dev-key') {
    throw new Error(`権限エラー: Tool "space_list" requires scope=org or scope=user (current: ${ctx.scope})`)
  }
  if (!ctx.allowedActions.includes('read')) {
    throw new Error('権限エラー: Action "read" not allowed for this API key')
  }

  let query = supabase
    .from('spaces')
    .select('*')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })

  if (params.type) {
    query = query.eq('type', params.type)
  }

  const { data, error } = await query

  if (error) throw hideDbError(error, 'space_list (org)', 'プロジェクト一覧の取得に失敗しました')
  return (data || []) as Space[]
}

export async function spaceGet(params: z.infer<typeof spaceGetSchema>): Promise<Space> {
  await checkAuth(params.spaceId, 'read', 'space_get', 'space', params.spaceId)
  const supabase = getSupabaseClient()

  const { data: spaceRow, error: spaceError } = await supabase.from('spaces').select('org_id').eq('id', params.spaceId).single()
  if (spaceError || !spaceRow) throw new Error('スペースが見つかりません')
  const orgId = spaceRow.org_id

  const { data, error } = await supabase
    .from('spaces')
    .select('*')
    .eq('id', params.spaceId)
    .eq('org_id', orgId)
    .single()

  if (error) throw notFoundOr(error, 'space_get', 'プロジェクトが見つかりません', 'プロジェクトの取得に失敗しました')
  return data as Space
}

// Tool definitions for MCP
export const spaceTools = [
  {
    name: 'space_create',
    description: 'プロジェクト新規作成',
    inputSchema: spaceCreateSchema,
    handler: spaceCreate,
  },
  {
    name: 'space_update',
    description: 'プロジェクト名更新',
    inputSchema: spaceUpdateSchema,
    handler: spaceUpdate,
  },
  {
    name: 'space_list',
    description: 'プロジェクト一覧取得。typeフィルタ可',
    inputSchema: spaceListSchema,
    handler: spaceList,
  },
  {
    name: 'space_get',
    description: 'プロジェクト詳細取得',
    inputSchema: spaceGetSchema,
    handler: spaceGet,
  },
]
