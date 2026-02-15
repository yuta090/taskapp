import { z } from 'zod'
import { getSupabaseClient, Task, TaskOwner } from '../supabase/client.js'
import { config } from '../config.js'

// Schemas
export const ballPassSchema = z.object({
  taskId: z.string().uuid().describe('タスクUUID'),
  ball: z.enum(['client', 'internal']).describe('新しいボール所有者'),
  clientOwnerIds: z.array(z.string().uuid()).default([]).describe('クライアント側担当者UUID配列'),
  internalOwnerIds: z.array(z.string().uuid()).default([]).describe('社内側担当者UUID配列'),
  reason: z.string().optional().describe('ボール移動の理由'),
})

export const ballQuerySchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUID'),
  ball: z.enum(['client', 'internal']).describe('検索するボール側'),
  includeOwners: z.boolean().default(false).describe('担当者情報を含めるか'),
  limit: z.number().min(1).max(100).default(50).describe('取得件数'),
})

export const dashboardGetSchema = z.object({
  spaceId: z.string().uuid().optional().describe('スペースUUID'),
})

// Tool implementations
export async function ballPass(params: z.infer<typeof ballPassSchema>): Promise<{ ok: boolean; task: Task }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = config.spaceId

  // Validate: ball=client requires client owners
  if (params.ball === 'client' && params.clientOwnerIds.length === 0) {
    throw new Error('ball=clientの場合はclientOwnerIdsが必須です')
  }

  // Pre-validate: verify task belongs to current tenant before RPC
  const { data: existingTask, error: checkError } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (checkError || !existingTask) {
    throw new Error('タスクが見つかりません')
  }

  // Call RPC function
  const { error } = await supabase.rpc('rpc_pass_ball', {
    p_task_id: params.taskId,
    p_ball: params.ball,
    p_client_owner_ids: params.clientOwnerIds,
    p_internal_owner_ids: params.internalOwnerIds,
    p_reason: params.reason || null,
    p_meeting_id: null,
  })

  if (error) throw new Error('ボール移動に失敗しました')

  // Fetch updated task with org/space scoping
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', params.taskId)
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .single()

  if (taskError) throw new Error('タスクが見つかりません')

  return { ok: true, task: task as Task }
}

export async function ballQuery(params: z.infer<typeof ballQuerySchema>): Promise<{ tasks: Task[]; owners?: Record<string, TaskOwner[]> }> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = params.spaceId || config.spaceId

  // Enforce org/space scoping for security
  const { data: tasks, error: tasksError } = await supabase
    .from('tasks')
    .select('*')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .eq('ball', params.ball)
    .order('created_at', { ascending: false })
    .limit(params.limit)

  if (tasksError) throw new Error('タスクの取得に失敗しました')

  const result: { tasks: Task[]; owners?: Record<string, TaskOwner[]> } = {
    tasks: (tasks || []) as Task[],
  }

  if (params.includeOwners && tasks && tasks.length > 0) {
    const taskIds = tasks.map((t: Task) => t.id)
    // Enforce org/space scoping for security
    const { data: owners, error: ownersError } = await supabase
      .from('task_owners')
      .select('*')
      .in('task_id', taskIds)
      .eq('org_id', orgId)
      .eq('space_id', spaceId)

    if (ownersError) throw new Error('担当者の取得に失敗しました')

    // Group by task_id
    const ownersByTask: Record<string, TaskOwner[]> = {}
    for (const owner of (owners || []) as TaskOwner[]) {
      if (!ownersByTask[owner.task_id]) {
        ownersByTask[owner.task_id] = []
      }
      ownersByTask[owner.task_id].push(owner)
    }
    result.owners = ownersByTask
  }

  return result
}

export interface DashboardData {
  totalTasks: number
  ballClient: number
  ballInternal: number
  considering: number
  inProgress: number
  inReview: number
  done: number
  recentTasks: Task[]
  clientWaitingTasks: Task[]
}

export async function dashboardGet(params: z.infer<typeof dashboardGetSchema>): Promise<DashboardData> {
  const supabase = getSupabaseClient()
  const orgId = config.orgId
  const spaceId = params.spaceId || config.spaceId

  // Get tasks with limited fields for performance (org/space scoped)
  const { data: allTasks, error } = await supabase
    .from('tasks')
    .select('id, title, status, ball, created_at')
    .eq('org_id', orgId)
    .eq('space_id', spaceId)
    .order('created_at', { ascending: false })
    .limit(500) // Limit to prevent DoS

  if (error) throw new Error('ダッシュボード情報の取得に失敗しました')

  const tasks = (allTasks || []) as Task[]

  // Calculate stats
  const stats: DashboardData = {
    totalTasks: tasks.length,
    ballClient: tasks.filter((t) => t.ball === 'client').length,
    ballInternal: tasks.filter((t) => t.ball === 'internal').length,
    considering: tasks.filter((t) => t.status === 'considering').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    inReview: tasks.filter((t) => t.status === 'in_review').length,
    done: tasks.filter((t) => t.status === 'done').length,
    recentTasks: tasks.slice(0, 10) as Task[],
    clientWaitingTasks: tasks
      .filter((t) => t.ball === 'client' && t.status !== 'done')
      .slice(0, 20) as Task[],
  }

  return stats
}

// Tool definitions for MCP
export const ballTools = [
  {
    name: 'ball_pass',
    description: 'ボール所有権移動。ball=client時clientOwnerIds必須',
    inputSchema: ballPassSchema,
    handler: ballPass,
  },
  {
    name: 'ball_query',
    description: 'ボール側でタスクフィルタ取得。includeOwnersで担当者含む',
    inputSchema: ballQuerySchema,
    handler: ballQuery,
  },
  {
    name: 'dashboard_get',
    description: 'ダッシュボード取得。統計・client待ち・最新タスク',
    inputSchema: dashboardGetSchema,
    handler: dashboardGet,
  },
]
