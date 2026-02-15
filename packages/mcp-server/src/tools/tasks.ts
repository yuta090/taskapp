import { z } from 'zod'
import { getSupabaseClient, Task, TaskOwner, TaskStatus } from '../supabase/client.js'
import { config, getAuthContext } from '../config.js'
import { authorizeAndLog, type ActionType } from '../auth/index.js'
import { dryRunDelete, confirmDelete } from '../auth/dryrun.js'

// Schemas
export const taskCreateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  title: z.string().min(1).describe('タスクのタイトル'),
  description: z.string().optional().describe('タスクの説明'),
  type: z.enum(['task', 'spec']).default('task').describe('タスクタイプ: task=通常, spec=仕様'),
  ball: z.enum(['client', 'internal']).default('internal').describe('ボール所有者: client=クライアント, internal=社内'),
  origin: z.enum(['client', 'internal']).default('internal').describe('起源: 誰が起票したか'),
  clientScope: z.enum(['deliverable', 'internal']).default('deliverable').describe('クライアント可視性: deliverable=ポータルに表示, internal=非表示'),
  clientOwnerIds: z.array(z.string().uuid()).default([]).describe('クライアント側担当者のUUID配列'),
  internalOwnerIds: z.array(z.string().uuid()).default([]).describe('社内側担当者のUUID配列'),
  dueDate: z.string().optional().describe('期限日 (YYYY-MM-DD)'),
  assigneeId: z.string().uuid().optional().describe('担当者UUID'),
  milestoneId: z.string().uuid().optional().describe('マイルストーンUUID'),
  specPath: z.string().optional().describe('仕様パス (type=specの場合必須, 例: /spec/v1/auth.md#login)'),
  decisionState: z.enum(['considering', 'decided', 'implemented']).optional().describe('仕様タスクの決定状態'),
})

export const taskUpdateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  taskId: z.string().uuid().describe('タスクUUID'),
  title: z.string().min(1).optional().describe('新しいタイトル'),
  description: z.string().optional().describe('新しい説明'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('新しいステータス'),
  dueDate: z.string().optional().describe('新しい期限日'),
  assigneeId: z.string().uuid().optional().describe('新しい担当者'),
  priority: z.number().min(0).max(3).optional().describe('優先度 (0-3)'),
  clientScope: z.enum(['deliverable', 'internal']).optional().describe('クライアント可視性: deliverable=ポータルに表示, internal=非表示'),
})

export const taskListSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  ball: z.enum(['client', 'internal']).optional().describe('ボールでフィルタ'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('ステータスでフィルタ'),
  type: z.enum(['task', 'spec']).optional().describe('タイプでフィルタ'),
  clientScope: z.enum(['deliverable', 'internal']).optional().describe('クライアント可視性でフィルタ'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

export const taskGetSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  taskId: z.string().uuid().describe('タスクUUID'),
})

export const taskDeleteSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  taskId: z.string().uuid().describe('削除するタスクのUUID'),
  dryRun: z.boolean().default(true).describe('trueの場合は削除せず影響範囲を確認。falseの場合はconfirmTokenが必要'),
  confirmToken: z.string().optional().describe('dryRun=falseの場合に必要な確認トークン'),
})

// ユーザー横断でのタスク一覧取得（新規）
export const taskListMySchema = z.object({
  ball: z.enum(['client', 'internal']).optional().describe('ボールでフィルタ'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('ステータスでフィルタ'),
  clientScope: z.enum(['deliverable', 'internal']).optional().describe('クライアント可視性でフィルタ'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

// Helper: 権限チェック
async function checkAuth(spaceId: string, action: ActionType, toolName: string, resourceId?: string) {
  const ctx = getAuthContext()
  const result = await authorizeAndLog({
    ctx,
    spaceId,
    action,
    toolName,
    resourceType: 'task',
    resourceId,
  })

  if (!result.allowed) {
    throw new Error(`権限エラー: ${result.reason}`)
  }

  return { ctx, role: result.role }
}

// Tool implementations
export async function taskCreate(params: z.infer<typeof taskCreateSchema>): Promise<{ task: Task; owners: TaskOwner[] }> {
  // 権限チェック（write権限が必要）
  await checkAuth(params.spaceId, 'write', 'task_create')

  const supabase = getSupabaseClient()

  // スペースからorg_idを取得
  const { data: space, error: spaceError } = await supabase
    .from('spaces')
    .select('org_id')
    .eq('id', params.spaceId)
    .single()

  if (spaceError || !space) {
    throw new Error('スペースが見つかりません')
  }

  const orgId = space.org_id

  // Validate spec task requirements
  if (params.type === 'spec') {
    if (!params.specPath) {
      throw new Error('仕様タスク(type=spec)にはspecPathが必須です')
    }
    if (!params.specPath.includes('/spec/') || !params.specPath.includes('#')) {
      throw new Error('specPathは /spec/...#anchor の形式で指定してください')
    }
  }

  // Validate ball=client requires client owners
  if (params.ball === 'client' && params.clientOwnerIds.length === 0) {
    throw new Error('ball=clientの場合はclientOwnerIdsが必須です')
  }

  const status: TaskStatus = params.type === 'spec' ? 'considering' : 'backlog'

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .insert({
      org_id: orgId,
      space_id: params.spaceId,
      title: params.title,
      description: params.description || '',
      status,
      ball: params.ball,
      origin: params.origin,
      type: params.type,
      spec_path: params.type === 'spec' ? params.specPath : null,
      decision_state: params.type === 'spec' ? (params.decisionState || 'considering') : null,
      client_scope: params.clientScope,
      due_date: params.dueDate || null,
      assignee_id: params.assigneeId || null,
      milestone_id: params.milestoneId || null,
      created_by: config.actorId,
    })
    .select('*')
    .single()

  if (taskError) throw new Error(`タスクの作成に失敗しました: ${taskError.message}`)

  // Create owners
  const ownerRows = [
    ...params.clientOwnerIds.map((userId) => ({
      org_id: orgId,
      space_id: params.spaceId,
      task_id: task.id,
      side: 'client' as const,
      user_id: userId,
    })),
    ...params.internalOwnerIds.map((userId) => ({
      org_id: orgId,
      space_id: params.spaceId,
      task_id: task.id,
      side: 'internal' as const,
      user_id: userId,
    })),
  ]

  let owners: TaskOwner[] = []
  if (ownerRows.length > 0) {
    const { data: ownersData, error: ownersError } = await supabase
      .from('task_owners')
      .insert(ownerRows)
      .select('*')

    if (ownersError) throw new Error('担当者の登録に失敗しました')
    owners = ownersData || []
  }

  return { task: task as Task, owners }
}

export async function taskUpdate(params: z.infer<typeof taskUpdateSchema>): Promise<Task> {
  // 権限チェック（write権限が必要、リソースIDも渡して所有権チェック）
  await checkAuth(params.spaceId, 'write', 'task_update', params.taskId)

  const supabase = getSupabaseClient()

  const updateData: Record<string, unknown> = {}
  if (params.title !== undefined) updateData.title = params.title
  if (params.description !== undefined) updateData.description = params.description
  if (params.status !== undefined) updateData.status = params.status
  if (params.dueDate !== undefined) updateData.due_date = params.dueDate
  if (params.assigneeId !== undefined) updateData.assignee_id = params.assigneeId
  if (params.priority !== undefined) updateData.priority = params.priority
  if (params.clientScope !== undefined) updateData.client_scope = params.clientScope

  if (Object.keys(updateData).length === 0) {
    throw new Error('更新するフィールドがありません')
  }

  updateData.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('tasks')
    .update(updateData)
    .eq('id', params.taskId)
    .eq('space_id', params.spaceId)
    .select('*')
    .single()

  if (error) throw new Error('タスク更新に失敗しました')
  return data as Task
}

export async function taskList(params: z.infer<typeof taskListSchema>): Promise<Task[]> {
  // 権限チェック（read権限が必要）
  await checkAuth(params.spaceId, 'read', 'task_list')

  const supabase = getSupabaseClient()

  let query = supabase
    .from('tasks')
    .select('*')
    .eq('space_id', params.spaceId)
    .order('created_at', { ascending: false })
    .limit(params.limit)

  if (params.ball) {
    query = query.eq('ball', params.ball)
  }
  if (params.status) {
    query = query.eq('status', params.status)
  }
  if (params.type) {
    query = query.eq('type', params.type)
  }
  if (params.clientScope) {
    query = query.eq('client_scope', params.clientScope)
  }

  const { data, error } = await query

  if (error) throw new Error('タスク一覧の取得に失敗しました')
  return (data || []) as Task[]
}

export async function taskGet(params: z.infer<typeof taskGetSchema>): Promise<{ task: Task; owners: TaskOwner[] }> {
  // 権限チェック（read権限が必要）
  await checkAuth(params.spaceId, 'read', 'task_get', params.taskId)

  const supabase = getSupabaseClient()

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', params.taskId)
    .eq('space_id', params.spaceId)
    .single()

  if (taskError) throw new Error('タスクが見つかりません')

  const { data: owners, error: ownersError } = await supabase
    .from('task_owners')
    .select('*')
    .eq('task_id', params.taskId)
    .eq('space_id', params.spaceId)

  if (ownersError) throw new Error('担当者の取得に失敗しました')

  return { task: task as Task, owners: (owners || []) as TaskOwner[] }
}

export async function taskDelete(params: z.infer<typeof taskDeleteSchema>): Promise<{
  success: boolean
  taskId?: string
  dryRun?: boolean
  affectedCount?: number
  confirmToken?: string
  message?: string
}> {
  // 権限チェック（delete権限が必要）
  await checkAuth(params.spaceId, 'delete', 'task_delete', params.taskId)

  const ctx = getAuthContext()

  // dry_run モードの場合
  if (params.dryRun) {
    const result = await dryRunDelete({
      ctx,
      spaceId: params.spaceId,
      resourceType: 'task',
      resourceIds: [params.taskId],
    })

    return {
      success: result.success,
      dryRun: true,
      affectedCount: result.affectedCount,
      confirmToken: result.confirmToken,
      message: result.message || result.error,
    }
  }

  // 実際の削除（confirmTokenが必要）
  if (!params.confirmToken) {
    throw new Error('削除を実行するにはconfirmTokenが必要です。先にdryRun=trueで確認してください。')
  }

  const result = await confirmDelete({
    ctx,
    confirmToken: params.confirmToken,
  })

  if (!result.success) {
    throw new Error(result.error || '削除に失敗しました')
  }

  return {
    success: true,
    taskId: params.taskId,
  }
}

// ユーザー横断でのタスク一覧（新規ツール）
export async function taskListMy(params: z.infer<typeof taskListMySchema>): Promise<{ spaceId: string; spaceName: string; tasks: Task[] }[]> {
  const ctx = getAuthContext()
  const supabase = getSupabaseClient()

  // scope='user' でない場合はエラー
  if (ctx.scope !== 'user') {
    throw new Error('このツールはscope=userのAPIキーでのみ使用できます')
  }

  if (!ctx.userId) {
    throw new Error('user_idが設定されていません')
  }

  // ユーザーが所属するスペース一覧を取得
  const { data: memberships, error: memberError } = await supabase
    .from('space_memberships')
    .select('space_id, spaces(id, name)')
    .eq('user_id', ctx.userId)

  if (memberError) {
    throw new Error('スペース一覧の取得に失敗しました')
  }

  // allowed_space_idsでフィルタ
  let spaceIds = memberships.map(m => m.space_id)
  if (ctx.allowedSpaceIds) {
    spaceIds = spaceIds.filter(id => ctx.allowedSpaceIds!.includes(id))
  }

  // 各スペースからタスクを取得
  const results: { spaceId: string; spaceName: string; tasks: Task[] }[] = []

  for (const membership of memberships) {
    if (!spaceIds.includes(membership.space_id)) continue

    // 権限チェック（read）
    const authResult = await authorizeAndLog({
      ctx,
      spaceId: membership.space_id,
      action: 'read',
      toolName: 'task_list_my',
    })

    if (!authResult.allowed) continue

    let query = supabase
      .from('tasks')
      .select('*')
      .eq('space_id', membership.space_id)
      .order('created_at', { ascending: false })
      .limit(params.limit)

    if (params.ball) {
      query = query.eq('ball', params.ball)
    }
    if (params.status) {
      query = query.eq('status', params.status)
    }
    if (params.clientScope) {
      query = query.eq('client_scope', params.clientScope)
    }

    const { data: tasks } = await query

    const spaceData = membership.spaces as unknown as { id: string; name: string }

    results.push({
      spaceId: membership.space_id,
      spaceName: spaceData?.name || 'Unknown',
      tasks: (tasks || []) as Task[],
    })
  }

  return results
}

// Tool definitions for MCP
export const taskTools = [
  {
    name: 'task_create',
    description: 'タスク新規作成。ball=client時clientOwnerIds必須、type=spec時specPath必須',
    inputSchema: taskCreateSchema,
    handler: taskCreate,
  },
  {
    name: 'task_update',
    description: 'タスク部分更新。指定フィールドのみ更新',
    inputSchema: taskUpdateSchema,
    handler: taskUpdate,
  },
  {
    name: 'task_list',
    description: 'タスク一覧取得。ball/status/type/clientScopeフィルタ可',
    inputSchema: taskListSchema,
    handler: taskList,
  },
  {
    name: 'task_get',
    description: 'タスク詳細+担当者取得',
    inputSchema: taskGetSchema,
    handler: taskGet,
  },
  {
    name: 'task_delete',
    description: '【破壊的】タスク削除。dryRun=true(既定)で確認、実行時confirmToken必要',
    inputSchema: taskDeleteSchema,
    handler: taskDelete,
  },
  {
    name: 'task_list_my',
    description: '【横断】全スペースのタスク一括取得。scope=user APIキー必要',
    inputSchema: taskListMySchema,
    handler: taskListMy,
  },
]
