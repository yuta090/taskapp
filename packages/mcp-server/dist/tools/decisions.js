import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { checkAuth } from '../auth/helpers.js';
import { requireActorUserId } from '../auth/scope.js';
import { mapRaiseExceptionError } from '../lib/rpcErrors.js';
import { buildTaskLink } from '../lib/appLinks.js';
/**
 * 「決定事項のタスク」を確定させる道具。画面のタスク詳細にある「決定にする」と同じもの。
 *
 * 確定の単位はページ全体ではなく決定1件。決定すると、紐づく Wiki ページに
 * 「決定: <タスクの題名> (日付)」が書き足され、書き足す前の本文が「確定時点の控え」として
 * 残る（`kind='decided'` の印付き）。詳しくは docs/spec/DECISION_RECORD_SPEC.md。
 */
const DECISION_STATES = ['considering', 'decided', 'implemented'];
export const specDecideSchema = z.object({
    spaceId: z.string().uuid().describe('スペースID'),
    taskId: z.string().uuid().describe('決定事項のタスク（type=spec のタスク）のID'),
    state: z
        .enum(DECISION_STATES)
        .describe('considering=検討中に戻す / decided=確定する / implemented=実装済みにする'),
    note: z.string().optional().describe('決定の補足（監査ログに残る）'),
    meetingId: z.string().uuid().optional().describe('この決定を行った会議のID（あれば）'),
});
export async function specDecide(params) {
    await checkAuth(params.spaceId, 'write', 'spec_decide', 'task', params.taskId);
    const supabase = getSupabaseClient();
    const { data: space, error: spaceError } = await supabase
        .from('spaces')
        .select('org_id')
        .eq('id', params.spaceId)
        .single();
    if (spaceError || !space)
        throw new Error('スペースが見つかりません');
    const orgId = space.org_id;
    // 別のスペースのタスクを動かせないよう、先に同じ場所のものか確かめる
    const { data: task, error: taskError } = await supabase
        .from('tasks')
        .select('id, title, type, decision_state, wiki_page_id, spec_path')
        .eq('id', params.taskId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (taskError || !task)
        throw new Error('タスクが見つかりません');
    const row = task;
    // 分かりやすい言葉で先に断る（DB 側も同じ条件で弾くが、生の英語が出ないように）
    if (row.type !== 'spec') {
        throw new Error('このタスクは「決定事項のタスク」ではありません。Wiki ページ（仕様書として扱う）を紐づけると決定事項のタスクになります');
    }
    if ((params.state === 'decided' || params.state === 'implemented') &&
        row.wiki_page_id === null &&
        row.spec_path === null) {
        throw new Error('決定を記録する資料が紐づいていません。先に Wiki ページを紐づけてください');
    }
    // 誰が決めたか（task_events.actor_id）は、鍵に紐づく利用者から取る
    const actor = requireActorUserId();
    const { error } = await supabase.rpc('rpc_set_spec_state_as', {
        p_actor: actor,
        p_task_id: params.taskId,
        p_decision_state: params.state,
        p_meeting_id: params.meetingId ?? null,
        p_note: params.note ?? null,
    });
    if (error)
        throw mapRaiseExceptionError(error.message, '決定の記録に失敗しました');
    return {
        ok: true,
        taskId: params.taskId,
        title: row.title,
        decisionState: params.state,
        wikiPageId: row.wiki_page_id,
        link: buildTaskLink(orgId, params.spaceId, params.taskId),
    };
}
export const decisionTools = [
    {
        name: 'spec_decide',
        description: '決定事項のタスクを確定する（画面の「決定にする」と同じ）。決定すると紐づく Wiki ページに決定行が入り、確定時点の本文が控えとして残る',
        inputSchema: specDecideSchema,
        handler: specDecide,
    },
];
//# sourceMappingURL=decisions.js.map