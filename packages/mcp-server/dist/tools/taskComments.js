import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { getAuthContext } from '../config.js';
import { authorizeAndLog } from '../auth/index.js';
import { ToolUserError } from '../errors.js';
import { requireActorUserId } from '../auth/scope.js';
import { hideDbError, notFoundOr } from '../lib/dbErrors.js';
import { buildTaskLink } from '../lib/appLinks.js';
// Schemas
export const taskCommentAddSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('コメントを付けるタスクのUUID'),
    body: z.string().min(1).max(10000).describe('コメント本文'),
    visibility: z.enum(['client', 'internal']).default('internal').describe('公開範囲: internal=社内だけ, client=相手先にも見える'),
});
export const taskCommentListSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    taskId: z.string().uuid().describe('タスクUUID'),
    limit: z.number().min(1).max(200).default(50).describe('取得件数'),
});
// Helper: 権限チェック
async function checkAuth(spaceId, action, toolName, resourceId) {
    const ctx = getAuthContext();
    const result = await authorizeAndLog({
        ctx,
        spaceId,
        action,
        toolName,
        resourceType: 'task',
        resourceId,
    });
    if (!result.allowed) {
        throw new Error(`権限エラー: ${result.reason}`);
    }
    return { ctx, role: result.role };
}
export async function taskCommentAdd(params) {
    // 権限チェック（write権限が必要）
    await checkAuth(params.spaceId, 'write', 'task_comment_add', params.taskId);
    // 個人に紐づかない鍵は、書いた人を決められないので弾く
    const actor = requireActorUserId();
    const supabase = getSupabaseClient();
    // 別 space のタスクには書けない。org_id はタスクから取る
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('id, org_id')
        .eq('id', params.taskId)
        .eq('space_id', params.spaceId)
        .single();
    if (taskError)
        throw notFoundOr(taskError, 'task_comment_add (task)', 'タスクが見つかりません', 'タスクが見つかりません');
    if (!task)
        throw new ToolUserError('タスクが見つかりません', 404);
    // 通知は DB トリガー（task_comments_notify）が出す
    const { data: comment, error: commentError } = await supabase
        .from('task_comments')
        .insert({
        org_id: task.org_id,
        space_id: params.spaceId,
        task_id: params.taskId,
        actor_id: actor,
        body: params.body,
        visibility: params.visibility,
        reply_to_id: null,
        mention_user_ids: [],
    })
        .select('*')
        .single();
    if (commentError)
        throw hideDbError(commentError, 'task_comment_add', 'コメントの追加に失敗しました');
    return {
        ...comment,
        link: buildTaskLink(task.org_id, params.spaceId, params.taskId),
    };
}
export async function taskCommentList(params) {
    // 権限チェック（read権限が必要）
    await checkAuth(params.spaceId, 'read', 'task_comment_list', params.taskId);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('task_comments')
        .select('*')
        .eq('space_id', params.spaceId)
        .eq('task_id', params.taskId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
        .limit(params.limit);
    if (error)
        throw hideDbError(error, 'task_comment_list', 'コメントの取得に失敗しました');
    const comments = (data || []);
    if (comments.length === 0)
        return comments;
    // 書いた人の名前（画面のコメント欄と同じく profiles.display_name）。失敗しても名前なしで返す
    const actorIds = [...new Set(comments.map((c) => c.actor_id))];
    const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', actorIds);
    if (profilesError) {
        console.error('task_comment_list (profiles) failed:', profilesError.code, profilesError.message);
        return comments;
    }
    const names = new Map((profiles || []).map((p) => [p.id, p.display_name]));
    return comments.map((c) => {
        const name = names.get(c.actor_id);
        return name ? { ...c, actor_name: name } : c;
    });
}
export const taskCommentTools = [
    {
        name: 'task_comment_add',
        description: 'タスクにコメントを追加。画面のコメント欄に出る。visibility=internal(既定)は社内だけ、client は相手先にも見える',
        inputSchema: taskCommentAddSchema,
        handler: taskCommentAdd,
    },
    {
        name: 'task_comment_list',
        description: 'タスクのコメント一覧（古い順）。書いた人の名前つき',
        inputSchema: taskCommentListSchema,
        handler: taskCommentList,
    },
];
//# sourceMappingURL=taskComments.js.map