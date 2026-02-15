import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { checkAuth } from '../auth/helpers.js';
// Helper: get orgId from spaceId
async function getOrgId(spaceId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single();
    if (error || !data)
        throw new Error('スペースが見つかりません');
    return data.org_id;
}
// Schemas
export const ballPassSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
    ball: z.enum(['client', 'internal']).describe('新しいボール所有者'),
    clientOwnerIds: z.array(z.string().uuid()).default([]).describe('クライアント側担当者UUID配列'),
    internalOwnerIds: z.array(z.string().uuid()).default([]).describe('社内側担当者UUID配列'),
    reason: z.string().optional().describe('ボール移動の理由'),
});
export const ballQuerySchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    ball: z.enum(['client', 'internal']).describe('検索するボール側'),
    includeOwners: z.boolean().default(false).describe('担当者情報を含めるか'),
    limit: z.number().min(1).max(100).default(50).describe('取得件数'),
});
export const dashboardGetSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
});
// Tool implementations
export async function ballPass(params) {
    await checkAuth(params.spaceId, 'write', 'ball_pass', 'task', params.taskId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    if (params.ball === 'client' && params.clientOwnerIds.length === 0) {
        throw new Error('ball=clientの場合はclientOwnerIdsが必須です');
    }
    const { data: existingTask, error: checkError } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (checkError || !existingTask) {
        throw new Error('タスクが見つかりません');
    }
    const { error } = await supabase.rpc('rpc_pass_ball', {
        p_task_id: params.taskId,
        p_ball: params.ball,
        p_client_owner_ids: params.clientOwnerIds,
        p_internal_owner_ids: params.internalOwnerIds,
        p_reason: params.reason || null,
        p_meeting_id: null,
    });
    if (error)
        throw new Error('ボール移動に失敗しました');
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (taskError)
        throw new Error('タスクが見つかりません');
    return { ok: true, task: task };
}
export async function ballQuery(params) {
    await checkAuth(params.spaceId, 'read', 'ball_query', 'task');
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: tasks, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .eq('ball', params.ball)
        .order('created_at', { ascending: false })
        .limit(params.limit);
    if (tasksError)
        throw new Error('タスクの取得に失敗しました');
    const result = {
        tasks: (tasks || []),
    };
    if (params.includeOwners && tasks && tasks.length > 0) {
        const taskIds = tasks.map((t) => t.id);
        const { data: owners, error: ownersError } = await supabase
            .from('task_owners')
            .select('*')
            .in('task_id', taskIds)
            .eq('org_id', orgId)
            .eq('space_id', params.spaceId);
        if (ownersError)
            throw new Error('担当者の取得に失敗しました');
        const ownersByTask = {};
        for (const owner of (owners || [])) {
            if (!ownersByTask[owner.task_id]) {
                ownersByTask[owner.task_id] = [];
            }
            ownersByTask[owner.task_id].push(owner);
        }
        result.owners = ownersByTask;
    }
    return result;
}
export async function dashboardGet(params) {
    await checkAuth(params.spaceId, 'read', 'dashboard_get', 'task');
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: allTasks, error } = await supabase
        .from('tasks')
        .select('id, title, status, ball, created_at')
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .order('created_at', { ascending: false })
        .limit(500);
    if (error)
        throw new Error('ダッシュボード情報の取得に失敗しました');
    const tasks = (allTasks || []);
    const stats = {
        totalTasks: tasks.length,
        ballClient: tasks.filter((t) => t.ball === 'client').length,
        ballInternal: tasks.filter((t) => t.ball === 'internal').length,
        considering: tasks.filter((t) => t.status === 'considering').length,
        inProgress: tasks.filter((t) => t.status === 'in_progress').length,
        inReview: tasks.filter((t) => t.status === 'in_review').length,
        done: tasks.filter((t) => t.status === 'done').length,
        recentTasks: tasks.slice(0, 10),
        clientWaitingTasks: tasks
            .filter((t) => t.ball === 'client' && t.status !== 'done')
            .slice(0, 20),
    };
    return stats;
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
];
//# sourceMappingURL=ball.js.map