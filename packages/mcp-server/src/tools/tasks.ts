import { z } from 'zod'
import { getSupabaseClient, Task, TaskOwner, TaskStatus } from '../supabase/client.js'
import { config, getAuthContext } from '../config.js'
import { authorizeAndLog, type ActionType } from '../auth/index.js'
import { dryRunDelete, confirmDelete } from '../auth/dryrun.js'
import { withTaskNumber } from '../lib/taskNumber.js'
import { ToolUserError } from '../errors.js'
import { flattenTaskInternalMetrics } from '../lib/taskMetrics.js'
import { assertInSpace, assertUsersAreSpaceMembers, assertUsersHaveSpaceRole, assertInvitesAreInSpace } from '../auth/scope.js'

// 画面の担当者選択肢と同じ範囲: 相手先側は client/vendor、社内側は admin/editor/viewer
const CLIENT_OWNER_ROLES = ['client', 'vendor'] as const
const INTERNAL_OWNER_ROLES = ['admin', 'editor', 'viewer'] as const

// Schemas
export const taskCreateSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  title: z.string().min(1).describe('タスクのタイトル'),
  description: z.string().optional().describe('タスクの説明'),
  type: z.enum(['task', 'spec']).default('task').describe('タスクタイプ: task=通常, spec=仕様'),
  ball: z.enum(['client', 'internal']).default('internal').describe('ボール所有者: client=クライアント, internal=社内'),
  origin: z.enum(['client', 'internal']).default('internal').describe('起源: 誰が起票したか'),
  clientScope: z.enum(['deliverable', 'internal']).default('deliverable').describe('クライアント可視性: deliverable=ポータルに表示, internal=非表示'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('作成時のステータス（省略時: task=backlog, spec=considering）'),
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
  startDate: z.string().optional().nullable().describe('開始日 (YYYY-MM-DD)'),
  parentTaskId: z.string().uuid().optional().nullable().describe('親タスクUUID（最大10階層）'),
  actualHours: z.number().min(0).optional().nullable().describe('実績工数'),
  milestoneId: z.string().uuid().optional().nullable().describe('マイルストーンUUID'),
  wikiPageId: z.string().uuid().optional().nullable().describe('紐づける WikiページUUID（null で解除）。画面の「仕様書連携」に対応'),
  assigneeEmail: z
    .string()
    .email()
    .optional()
    .describe('担当者をメールで指定する。組織メンバーなら本人、招待中なら招待を担当にする（承諾時に自動で本人へ移る）'),
  assigneeInviteId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .describe('招待中の担当者（invites.id）。承諾時に本人へ自動で移る。assigneeId とは排他（片方を入れると他方は消える）'),
})

export const taskListSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  ball: z.enum(['client', 'internal']).optional().describe('ボールでフィルタ'),
  status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('ステータスでフィルタ'),
  type: z.enum(['task', 'spec']).optional().describe('タイプでフィルタ'),
  clientScope: z.enum(['deliverable', 'internal']).optional().describe('クライアント可視性でフィルタ'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
  offset: z.number().int().min(0).default(0).describe('先頭からスキップする件数（続きから取る用。既定0）'),
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
  offset: z.number().int().min(0).default(0).describe('先頭からスキップする件数（続きから取る用。既定0）'),
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

  // 担当者・担当者一覧は、画面の担当者選択肢と同じ範囲（このプロジェクトのメンバー）に限る。
  // clientOwnerIds/internalOwnerIdsは、さらに画面の選択肢と同じ役割（相手先側/社内側）まで確かめる
  if (params.assigneeId) await assertUsersAreSpaceMembers([params.assigneeId], params.spaceId)
  await assertUsersHaveSpaceRole(params.clientOwnerIds, params.spaceId, CLIENT_OWNER_ROLES, 'clientOwnerIds')
  await assertUsersHaveSpaceRole(params.internalOwnerIds, params.spaceId, INTERNAL_OWNER_ROLES, 'internalOwnerIds')

  // 明示指定があればそれで作る（CLI の --status）。無指定のときの既定は従来どおり。
  const status: TaskStatus = params.status ?? (params.type === 'spec' ? 'considering' : 'backlog')

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

/**
 * 担当者をメールから解決する。組織メンバーなら本人（assignee_id）、まだ承諾していない招待なら
 * その招待（assignee_invite_id）を返す。招待中の人も担当にできるようにするための入口で、
 * 「参加するまで担当欄が空のまま」を避ける。
 */
async function resolveAssigneeByEmail(
  orgId: string,
  spaceId: string,
  email: string,
): Promise<{ assignee_id: string; assignee_invite_id: null } | { assignee_id: null; assignee_invite_id: string }> {
  const supabase = getSupabaseClient()
  const normalized = email.trim().toLowerCase()

  // 1) このプロジェクトのメンバー（auth.users はメールで直接引けないので listUsers を使う）。
  // 担当者ID・招待IDの直接指定と同じ範囲（プロジェクトのメンバー）に限る
  const { data: members, error: memberError } = await supabase
    .from('space_memberships')
    .select('user_id')
    .eq('space_id', spaceId)
  if (memberError) throw new Error('メンバーの確認に失敗しました: ' + memberError.message)
  const memberIds = new Set((members ?? []).map((m: { user_id: string }) => m.user_id))

  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
    if (error) throw new Error('ユーザー情報の取得に失敗しました: ' + error.message)
    const users = data?.users ?? []
    const hit = users.find((u) => u.email?.toLowerCase() === normalized && memberIds.has(u.id))
    if (hit) return { assignee_id: hit.id, assignee_invite_id: null }
    if (users.length < 1000) break
  }

  // 2) まだ承諾していない招待（同じスペース宛のもの）
  const { data: invite, error: inviteError } = await supabase
    .from('invites')
    .select('id')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .eq('email', normalized)
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (inviteError) throw new Error('招待の確認に失敗しました: ' + inviteError.message)
  if (invite) return { assignee_id: null, assignee_invite_id: (invite as { id: string }).id }

  throw new ToolUserError(
    `「${email}」はこのプロジェクトのメンバーにも、有効な招待にも見つかりません（先に招待してください）`,
    404,
  )
}

/**
 * 完了の関所（DB の enforce_review_gate・check_violation）に止められたときの、呼んだ人向けの理由。
 * 止めた理由は決まった文言で秘密を含まない。該当しなければ null
 */
function completionGateReason(error: { code?: string; message?: string }): string | null {
  if (error.code !== '23514') return null
  if (error.message?.includes('review is not approved')) {
    return 'レビューの承認が済んでいないため、完了にできません。承認されてから完了にしてください'
  }
  if (error.message?.includes('spec decision is not made')) {
    return '仕様の決定（decision_state）が済んでいないため、完了にできません'
  }
  return null
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
  if (params.assigneeId !== undefined) {
    // 担当者は、画面の担当者選択肢と同じ範囲（このプロジェクトのメンバー）に限る
    if (params.assigneeId !== null) await assertUsersAreSpaceMembers([params.assigneeId], params.spaceId)
    updateData.assignee_id = params.assigneeId
  }
  if (params.priority !== undefined) updateData.priority = params.priority
  if (params.clientScope !== undefined) updateData.client_scope = params.clientScope
  if (params.startDate !== undefined) updateData.start_date = params.startDate
  if (params.parentTaskId !== undefined) updateData.parent_task_id = params.parentTaskId
  if (params.milestoneId !== undefined) updateData.milestone_id = params.milestoneId
  if (params.wikiPageId !== undefined) {
    // 指定する Wiki ページは同じ space のものに限る（解除=nullは確認不要）
    if (params.wikiPageId !== null) {
      await assertInSpace('wiki_pages', params.wikiPageId, params.spaceId, '紐づけるWikiページが見つかりません')
    }
    updateData.wiki_page_id = params.wikiPageId
  }
  // 担当者は「本人」か「招待中の招待」のどちらか一方だけ（DB の tasks_single_assignee_chk）。
  // 片方を指定したら、もう片方は明示的に消してから入れる
  if (params.assigneeEmail !== undefined) {
    const { data: space } = await supabase.from('spaces').select('org_id').eq('id', params.spaceId).single()
    if (!space) throw new Error('スペースが見つかりません')
    const resolved = await resolveAssigneeByEmail((space as { org_id: string }).org_id, params.spaceId, params.assigneeEmail)
    updateData.assignee_id = resolved.assignee_id
    updateData.assignee_invite_id = resolved.assignee_invite_id
  }
  if (params.assigneeInviteId !== undefined) {
    // 招待は、このプロジェクトの未受諾・期限内の招待に限る
    if (params.assigneeInviteId !== null) await assertInvitesAreInSpace([params.assigneeInviteId], params.spaceId)
    updateData.assignee_invite_id = params.assigneeInviteId
    if (params.assigneeInviteId !== null && params.assigneeId === undefined) updateData.assignee_id = null
  }
  if (params.assigneeId !== undefined && params.assigneeId !== null && params.assigneeInviteId === undefined) {
    updateData.assignee_invite_id = null
  }

  if (Object.keys(updateData).length === 0 && params.actualHours === undefined) {
    throw new Error('更新するフィールドがありません')
  }

  // actualHours(実績工数)は tasks の列ではなく、社内専用の別表 task_internal_metrics
  // へ書く。それ以外の変更が無ければ tasks 自体は更新しない
  let data: Task | null = null
  if (Object.keys(updateData).length > 0) {
    updateData.updated_at = new Date().toISOString()

    const { data: updated, error } = await supabase
      .from('tasks')
      .update(updateData)
      .eq('id', params.taskId)
      .eq('space_id', params.spaceId)
      .select('*, task_internal_metrics (actual_hours)')
      .single()

    if (error) {
      const gateReason = completionGateReason(error)
      if (gateReason) throw new ToolUserError(gateReason, 409)
      // それ以外の DB の理由は中身を含むので呼んだ人には返さず、サーバーのログにだけ残す
      console.error('task_update failed:', error.code, error.message)
      throw new Error('タスク更新に失敗しました')
    }
    data = flattenTaskInternalMetrics(updated as Task)
  }

  if (params.actualHours !== undefined) {
    // mcp-server は service role（RLSを通らない）で動くため、tasks 自体を更新
    // しなかった(= data がまだ無い)場合は、このタスクが渡された space に属するかを
    // 事前に確かめる。tasks の更新が走った場合は既に id・space_id で絞られている
    if (!data) {
      const { data: taskInSpace, error: taskCheckError } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', params.taskId)
        .eq('space_id', params.spaceId)
        .maybeSingle()

      if (taskCheckError) throw new Error('タスク更新に失敗しました')
      if (!taskInSpace) throw new Error('タスクが見つかりません')
    }

    const { error: metricsError } = await supabase
      .from('task_internal_metrics')
      .upsert({ task_id: params.taskId, actual_hours: params.actualHours }, { onConflict: 'task_id' })

    if (metricsError) {
      // tasks 側の更新(あれば)は既にDBへ反映済みで、この呼び出しでは戻せない
      // （半分だけ保存された状態）。どこまで保存されたかは秘密を含まないので、
      // 呼んだ人に見せてよい理由として返す（ToolUserError でないと /api/tools が
      // 中身を隠した500に潰してしまい、CLI/AIに届かない）
      throw new ToolUserError(
        data
          ? 'タイトル等は更新できましたが、実績工数の更新に失敗しました'
          : '実績工数の更新に失敗しました',
        400
      )
    }
  }

  if (!data) {
    const { data: fetched, error: fetchError } = await supabase
      .from('tasks')
      .select('*, task_internal_metrics (actual_hours)')
      .eq('id', params.taskId)
      .eq('space_id', params.spaceId)
      .single()

    if (fetchError) throw new Error('タスク更新に失敗しました')
    data = flattenTaskInternalMetrics(fetched as Task)
  }

  // fetched/updated 行は upsert 前の値を持ちうるため、渡した値で上書きして返す
  if (params.actualHours !== undefined) {
    data = { ...data, actual_hours: params.actualHours }
  }

  return data
}

export async function taskList(params: z.infer<typeof taskListSchema>): Promise<Task[]> {
  // 権限チェック（read権限が必要）
  await checkAuth(params.spaceId, 'read', 'task_list')

  const supabase = getSupabaseClient()

  let query = supabase
    .from('tasks')
    .select('*, task_internal_metrics (actual_hours)')
    .eq('space_id', params.spaceId)
    .order('created_at', { ascending: false })
    .range(params.offset, params.offset + params.limit - 1)

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
  return ((data || []) as Task[]).map((t) => withTaskNumber(flattenTaskInternalMetrics(t)))
}

export async function taskGet(params: z.infer<typeof taskGetSchema>): Promise<{ task: Task; owners: TaskOwner[] }> {
  // 権限チェック（read権限が必要）
  await checkAuth(params.spaceId, 'read', 'task_get', params.taskId)

  const supabase = getSupabaseClient()

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*, task_internal_metrics (actual_hours)')
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

  return {
    task: withTaskNumber(flattenTaskInternalMetrics(task as Task)),
    owners: (owners || []) as TaskOwner[],
  }
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
    throw new ToolUserError(
      'このツールはscope=userのAPIキーでのみ使用できます（個人用の鍵が必要です。プロジェクト内の一覧は task list を使ってください）',
      403,
    )
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
      .select('*, task_internal_metrics (actual_hours)')
      .eq('space_id', membership.space_id)
      .order('created_at', { ascending: false })
      .range(params.offset, params.offset + params.limit - 1)

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
      tasks: ((tasks || []) as Task[]).map((t) => withTaskNumber(flattenTaskInternalMetrics(t))),
    })
  }

  return results
}

// ── task_stale ───────────────────────────────────────────

export const taskStaleSchema = z.object({
  spaceId: z.string().uuid().describe('スペースUUID（必須）'),
  staleDays: z.number().min(1).max(90).default(7).describe('更新がない日数の閾値'),
  ball: z.enum(['client', 'internal']).optional().describe('ボールでフィルタ'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

export async function taskStale(params: z.infer<typeof taskStaleSchema>): Promise<Task[]> {
  await checkAuth(params.spaceId, 'read', 'task_stale')

  const supabase = getSupabaseClient()

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - params.staleDays)
  const cutoffIso = cutoff.toISOString()

  let query = supabase
    .from('tasks')
    .select('*, task_internal_metrics (actual_hours)')
    .eq('space_id', params.spaceId)
    .neq('status', 'done')
    .lt('updated_at', cutoffIso)
    .order('updated_at', { ascending: true })
    .limit(params.limit)

  if (params.ball) {
    query = query.eq('ball', params.ball)
  }

  const { data, error } = await query

  if (error) throw new Error('滞留タスクの取得に失敗しました')
  return ((data || []) as Task[]).map(flattenTaskInternalMetrics)
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
    description: 'タスク一覧取得。ball/status/type/clientScopeフィルタ可。offsetで続きから取得可',
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
  {
    name: 'task_stale',
    description: '滞留タスク検出。staleDays日以上更新なし＋未完了のタスクを返す',
    inputSchema: taskStaleSchema,
    handler: taskStale,
  },
]
