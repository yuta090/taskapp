import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { checkAuth } from '../auth/helpers.js';
import { assertUsersHaveSpaceRole, requireActorUserId } from '../auth/scope.js';
import { mapRaiseExceptionError } from '../lib/rpcErrors.js';
import { ToolUserError } from '../errors.js';
// 画面の承認者候補と同じ役割の範囲（社内のadmin/editorだけ。rpc_review_open_asも同じ規則）
const REVIEW_APPROVER_ROLES = ['admin', 'editor'];
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
export const reviewCancelSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
});
export const reviewListSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    status: z
        .enum(['open', 'approved', 'changes_requested', 'cancelled'])
        .optional()
        .describe('ステータスでフィルタ'),
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
    // 承認者は、画面の承認者候補と同じ範囲・役割（社内のadmin/editor）に限る
    await assertUsersHaveSpaceRole(params.reviewerIds, params.spaceId, REVIEW_APPROVER_ROLES, 'reviewerIds');
    // 依頼した人（reviews.created_by・task_events.actor_id）は、鍵に紐づく利用者から取る
    const actor = requireActorUserId();
    const { error } = await supabase.rpc('rpc_review_open_as', {
        p_actor: actor,
        p_task_id: params.taskId,
        p_reviewer_ids: params.reviewerIds,
        p_meeting_id: null,
    });
    if (error)
        throw mapRaiseExceptionError(error.message, 'レビューの開始に失敗しました');
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
    // 承認するのは呼んだ本人の分だけ（review_approvals.reviewer_id）。鍵に紐づく利用者から取る
    const actor = requireActorUserId();
    const { data, error } = await supabase.rpc('rpc_review_approve_as', {
        p_actor: actor,
        p_task_id: params.taskId,
        p_meeting_id: null,
    });
    if (error)
        throw mapRaiseExceptionError(error.message, 'レビューの承認に失敗しました');
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
    // ブロックするのは呼んだ本人の分だけ（review_approvals.reviewer_id）。鍵に紐づく利用者から取る
    const actor = requireActorUserId();
    const { error } = await supabase.rpc('rpc_review_block_as', {
        p_actor: actor,
        p_task_id: params.taskId,
        p_blocked_reason: params.reason,
        p_meeting_id: null,
    });
    if (error)
        throw mapRaiseExceptionError(error.message, 'レビューのブロックに失敗しました');
    return { ok: true };
}
/**
 * 承認依頼を取り消す（画面のタスク詳細にある「レビューを取り消す」と同じ）。
 *
 * 取り消せるのは、まだ終わっていない依頼（承認待ち・差し戻し）だけ。誰が取り消せるか
 * （依頼した本人・プロジェクトの管理者・組織のオーナー）は DB 側が決める。
 * CLI が持っているのはタスクの UUID なので、対象の review はタスクから引き当てる
 * （reviews は task_id に一意制約があるので1件に定まる）。
 */
export async function reviewCancel(params) {
    await checkAuth(params.spaceId, 'write', 'review_cancel', 'review', params.taskId);
    // 取り消した人（task_events.actor_id・通知の差出人）は、鍵に紐づく利用者から取る。
    // 組織・プロジェクト共用の鍵では必ず断るので、問い合わせに行く前に確かめる
    const actor = requireActorUserId();
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: existingTask, error: checkError } = await supabase
        .from('tasks')
        .select('id')
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    // 打ち間違い・別プロジェクトのタスクは、理由を呼んだ人に返す（一般的な Error は 500 に化けて理由が届かない）
    if (checkError || !existingTask) {
        throw new ToolUserError('タスクが見つからないか、このプロジェクトのものではありません', 404);
    }
    const { data: review, error: reviewError } = await supabase
        .from('reviews')
        .select('id')
        .eq('task_id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .maybeSingle();
    if (reviewError)
        throw new Error('レビューの取得に失敗しました');
    if (!review)
        throw new ToolUserError('このタスクにはレビューがありません', 404);
    const { error } = await supabase.rpc('rpc_review_cancel_as', {
        p_actor: actor,
        p_review_id: review.id,
    });
    if (error)
        throw mapRaiseExceptionError(error.message, 'レビューの取り消しに失敗しました');
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
        name: 'review_cancel',
        description: 'レビュー取り消し。承認待ち・差し戻しの依頼を畳む。依頼者/管理者/オーナーのみ',
        inputSchema: reviewCancelSchema,
        handler: reviewCancel,
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