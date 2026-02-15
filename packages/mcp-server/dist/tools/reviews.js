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
export const reviewOpenSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
    reviewerIds: z.array(z.string().uuid()).min(1).describe('レビュアーUUID配列（1人以上必須）'),
});
export const reviewApproveSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
});
export const reviewBlockSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
    reason: z.string().min(1).describe('ブロック理由'),
});
export const reviewListSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    status: z.enum(['open', 'approved', 'changes_requested']).optional().describe('ステータスでフィルタ'),
    limit: z.number().min(1).max(100).default(20).describe('取得件数'),
});
export const reviewGetSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
});
// Tool implementations
export async function reviewOpen(params) {
    await checkAuth(params.spaceId, 'write', 'review_open', 'review', params.taskId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
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
    const { error } = await supabase.rpc('rpc_review_open', {
        p_task_id: params.taskId,
        p_reviewer_ids: params.reviewerIds,
        p_meeting_id: null,
    });
    if (error)
        throw new Error('レビューの開始に失敗しました');
    const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('*')
        .eq('task_id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (reviewError)
        throw new Error('レビューが見つかりません');
    return { ok: true, review: review };
}
export async function reviewApprove(params) {
    await checkAuth(params.spaceId, 'write', 'review_approve', 'review', params.taskId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
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
    const { data, error } = await supabase.rpc('rpc_review_approve', {
        p_task_id: params.taskId,
        p_meeting_id: null,
    });
    if (error)
        throw new Error('レビューの承認に失敗しました');
    return {
        ok: true,
        allApproved: data?.allApproved || false,
    };
}
export async function reviewBlock(params) {
    await checkAuth(params.spaceId, 'write', 'review_block', 'review', params.taskId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
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
    const { error } = await supabase.rpc('rpc_review_block', {
        p_task_id: params.taskId,
        p_blocked_reason: params.reason,
        p_meeting_id: null,
    });
    if (error)
        throw new Error('レビューのブロックに失敗しました');
    return { ok: true };
}
export async function reviewList(params) {
    await checkAuth(params.spaceId, 'read', 'review_list', 'review');
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    let query = supabase
        .from('reviews')
        .select('*')
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .order('created_at', { ascending: false })
        .limit(params.limit);
    if (params.status) {
        query = query.eq('status', params.status);
    }
    const { data, error } = await query;
    if (error)
        throw new Error('レビュー一覧の取得に失敗しました');
    return (data || []);
}
export async function reviewGet(params) {
    await checkAuth(params.spaceId, 'read', 'review_get', 'review', params.taskId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('*')
        .eq('task_id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .maybeSingle();
    if (reviewError)
        throw new Error('レビューの取得に失敗しました');
    if (!review) {
        return { review: null, approvals: [] };
    }
    const { data: approvals, error: approvalsError } = await supabase
        .from('review_approvals')
        .select('*')
        .eq('review_id', review.id)
        .eq('org_id', orgId);
    if (approvalsError)
        throw new Error('承認状態の取得に失敗しました');
    return {
        review: review,
        approvals: (approvals || []),
    };
}
// Tool definitions for MCP
export const reviewTools = [
    {
        name: 'review_open',
        description: 'レビュー開始。レビュアー1名以上必須',
        inputSchema: reviewOpenSchema,
        handler: reviewOpen,
    },
    {
        name: 'review_approve',
        description: 'レビュー承認。全員承認で自動クローズ',
        inputSchema: reviewApproveSchema,
        handler: reviewApprove,
    },
    {
        name: 'review_block',
        description: 'レビューブロック(変更要求)。理由必須',
        inputSchema: reviewBlockSchema,
        handler: reviewBlock,
    },
    {
        name: 'review_list',
        description: 'レビュー一覧取得。statusフィルタ可',
        inputSchema: reviewListSchema,
        handler: reviewList,
    },
    {
        name: 'review_get',
        description: 'レビュー詳細+各レビュアー承認状態取得',
        inputSchema: reviewGetSchema,
        handler: reviewGet,
    },
];
//# sourceMappingURL=reviews.js.map