import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { config } from '../config.js';
// Schemas
export const taskCreateSchema = z.object({
    title: z.string().min(1).describe('タスクのタイトル'),
    description: z.string().optional().describe('タスクの説明'),
    type: z.enum(['task', 'spec']).default('task').describe('タスクタイプ: task=通常, spec=仕様'),
    ball: z.enum(['client', 'internal']).default('internal').describe('ボール所有者: client=クライアント, internal=社内'),
    origin: z.enum(['client', 'internal']).default('internal').describe('起源: 誰が起票したか'),
    clientOwnerIds: z.array(z.string().uuid()).default([]).describe('クライアント側担当者のUUID配列'),
    internalOwnerIds: z.array(z.string().uuid()).default([]).describe('社内側担当者のUUID配列'),
    dueDate: z.string().optional().describe('期限日 (YYYY-MM-DD)'),
    assigneeId: z.string().uuid().optional().describe('担当者UUID'),
    milestoneId: z.string().uuid().optional().describe('マイルストーンUUID'),
    specPath: z.string().optional().describe('仕様パス (type=specの場合必須, 例: /spec/v1/auth.md#login)'),
    decisionState: z.enum(['considering', 'decided', 'implemented']).optional().describe('仕様タスクの決定状態'),
});
export const taskUpdateSchema = z.object({
    taskId: z.string().uuid().describe('タスクUUID'),
    title: z.string().min(1).optional().describe('新しいタイトル'),
    description: z.string().optional().describe('新しい説明'),
    status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('新しいステータス'),
    dueDate: z.string().optional().describe('新しい期限日'),
    assigneeId: z.string().uuid().optional().describe('新しい担当者'),
    priority: z.number().min(0).max(3).optional().describe('優先度 (0-3)'),
});
export const taskListSchema = z.object({
    spaceId: z.string().uuid().optional().describe('スペースUUID (省略時はデフォルト)'),
    ball: z.enum(['client', 'internal']).optional().describe('ボールでフィルタ'),
    status: z.enum(['backlog', 'todo', 'in_progress', 'in_review', 'done', 'considering']).optional().describe('ステータスでフィルタ'),
    type: z.enum(['task', 'spec']).optional().describe('タイプでフィルタ'),
    limit: z.number().min(1).max(100).default(50).describe('取得件数'),
});
export const taskGetSchema = z.object({
    taskId: z.string().uuid().describe('タスクUUID'),
});
export const taskDeleteSchema = z.object({
    taskId: z.string().uuid().describe('削除するタスクのUUID'),
});
// Tool implementations
export async function taskCreate(params) {
    const supabase = getSupabaseClient();
    const spaceId = config.spaceId;
    const orgId = config.orgId;
    // Validate spec task requirements
    if (params.type === 'spec') {
        if (!params.specPath) {
            throw new Error('仕様タスク(type=spec)にはspecPathが必須です');
        }
        if (!params.specPath.includes('/spec/') || !params.specPath.includes('#')) {
            throw new Error('specPathは /spec/...#anchor の形式で指定してください');
        }
    }
    // Validate ball=client requires client owners
    if (params.ball === 'client' && params.clientOwnerIds.length === 0) {
        throw new Error('ball=clientの場合はclientOwnerIdsが必須です');
    }
    const status = params.type === 'spec' ? 'considering' : 'backlog';
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .insert({
        org_id: orgId,
        space_id: spaceId,
        title: params.title,
        description: params.description || '',
        status,
        ball: params.ball,
        origin: params.origin,
        type: params.type,
        spec_path: params.type === 'spec' ? params.specPath : null,
        decision_state: params.type === 'spec' ? (params.decisionState || 'considering') : null,
        due_date: params.dueDate || null,
        assignee_id: params.assigneeId || null,
        milestone_id: params.milestoneId || null,
        created_by: config.actorId,
    })
        .select('*')
        .single();
    if (taskError)
        throw new Error(`タスクの作成に失敗しました: ${taskError.message}`);
    // Create owners
    const ownerRows = [
        ...params.clientOwnerIds.map((userId) => ({
            org_id: orgId,
            space_id: spaceId,
            task_id: task.id,
            side: 'client',
            user_id: userId,
        })),
        ...params.internalOwnerIds.map((userId) => ({
            org_id: orgId,
            space_id: spaceId,
            task_id: task.id,
            side: 'internal',
            user_id: userId,
        })),
    ];
    let owners = [];
    if (ownerRows.length > 0) {
        const { data: ownersData, error: ownersError } = await supabase
            .from('task_owners')
            .insert(ownerRows)
            .select('*');
        if (ownersError)
            throw new Error('担当者の登録に失敗しました');
        owners = ownersData || [];
    }
    return { task: task, owners };
}
export async function taskUpdate(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    const updateData = {};
    if (params.title !== undefined)
        updateData.title = params.title;
    if (params.description !== undefined)
        updateData.description = params.description;
    if (params.status !== undefined)
        updateData.status = params.status;
    if (params.dueDate !== undefined)
        updateData.due_date = params.dueDate;
    if (params.assigneeId !== undefined)
        updateData.assignee_id = params.assigneeId;
    if (params.priority !== undefined)
        updateData.priority = params.priority;
    if (Object.keys(updateData).length === 0) {
        throw new Error('更新するフィールドがありません');
    }
    updateData.updated_at = new Date().toISOString();
    // Enforce org/space scoping for security
    const { data, error } = await supabase
        .from('tasks')
        .update(updateData)
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .select('*')
        .single();
    if (error)
        throw new Error('タスク更新に失敗しました');
    return data;
}
export async function taskList(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = params.spaceId || config.spaceId;
    // Enforce org/space scoping for security
    let query = supabase
        .from('tasks')
        .select('*')
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .limit(params.limit);
    if (params.ball) {
        query = query.eq('ball', params.ball);
    }
    if (params.status) {
        query = query.eq('status', params.status);
    }
    if (params.type) {
        query = query.eq('type', params.type);
    }
    const { data, error } = await query;
    if (error)
        throw new Error('タスク一覧の取得に失敗しました');
    return (data || []);
}
export async function taskGet(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    // Enforce org/space scoping for security
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .single();
    if (taskError)
        throw new Error('タスクが見つかりません');
    const { data: owners, error: ownersError } = await supabase
        .from('task_owners')
        .select('*')
        .eq('task_id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId);
    if (ownersError)
        throw new Error('担当者の取得に失敗しました');
    return { task: task, owners: (owners || []) };
}
export async function taskDelete(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    // Enforce org/space scoping for security
    const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId);
    if (error)
        throw new Error('タスクの削除に失敗しました');
    return { success: true, taskId: params.taskId };
}
// Tool definitions for MCP
export const taskTools = [
    {
        name: 'task_create',
        description: 'タスクを新規作成します。ball=clientの場合はclientOwnerIdsが必須です。type=specの場合はspecPathが必須です。',
        inputSchema: taskCreateSchema,
        handler: taskCreate,
    },
    {
        name: 'task_update',
        description: 'タスクを更新します。指定したフィールドのみ更新されます。',
        inputSchema: taskUpdateSchema,
        handler: taskUpdate,
    },
    {
        name: 'task_list',
        description: 'タスク一覧を取得します。ball, status, typeでフィルタ可能です。',
        inputSchema: taskListSchema,
        handler: taskList,
    },
    {
        name: 'task_get',
        description: 'タスクの詳細と担当者を取得します。',
        inputSchema: taskGetSchema,
        handler: taskGet,
    },
    {
        name: 'task_delete',
        description: 'タスクを削除します。関連する担当者データも削除されます。',
        inputSchema: taskDeleteSchema,
        handler: taskDelete,
    },
];
//# sourceMappingURL=tasks.js.map