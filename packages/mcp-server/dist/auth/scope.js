/**
 * 道具の共通の範囲照合。
 *
 * CLI/MCP の道具は service role（DB の見張り=RLS を素通りする管理用の鍵）で動くため、
 * 入口の checkAuth（mcp_authorize）が確かめるのは「鍵 × 渡された spaceId × 役割」だけで、
 * 引数で受け取った ID（wikiPageId など）がその space のものかまでは見ない。道具側で
 * 読み書きの前にこの確認を通す。
 */
import { getSupabaseClient } from '../supabase/client.js';
import { ToolUserError } from '../errors.js';
/**
 * 指定した表の行(id)が、指定した space のものであることを確かめる。
 * 別の space の行・存在しない行は、呼んだ人に見せてよい理由(404)として断る。
 */
export async function assertInSpace(table, id, spaceId, notFoundMessage = '指定されたIDが見つからないか、このプロジェクトのものではありません') {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from(table)
        .select('id')
        .eq('id', id)
        .eq('space_id', spaceId)
        .maybeSingle();
    if (error)
        throw new Error(`確認に失敗しました（${table}）`);
    if (!data)
        throw new ToolUserError(notFoundMessage, 404);
}
/**
 * 渡した user たちが、指定した space の組織のメンバーであることを確かめる。
 * 1人でも組織外なら断る（呼んだ人に見せてよい理由=404。403にすると「組織に
 * いる/いない」自体を外部に教えてしまうため、行が無いときと同じ形で返す）。
 * 呼び出し側が組織での役割をそのまま使えるよう、確かめた行を user_id をキーに返す。
 */
export async function assertUsersInSpaceOrg(userIds, spaceId) {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0)
        return new Map();
    const supabase = getSupabaseClient();
    const { data: space, error: spaceError } = await supabase
        .from('spaces')
        .select('org_id')
        .eq('id', spaceId)
        .single();
    if (spaceError || !space)
        throw new Error('スペースが見つかりません');
    const { data: memberships, error: memberError } = await supabase
        .from('org_memberships')
        .select('user_id, role')
        .eq('org_id', space.org_id)
        .in('user_id', uniqueIds);
    if (memberError)
        throw new Error('メンバーの確認に失敗しました');
    const byUser = new Map((memberships || []).map((m) => [
        m.user_id,
        { role: m.role },
    ]));
    const missing = uniqueIds.filter((id) => !byUser.has(id));
    if (missing.length > 0) {
        throw new ToolUserError('対象のユーザーがこの組織のメンバーではありません', 404);
    }
    return byUser;
}
/**
 * 渡した user たちが、指定した space のメンバーであることを確かめる（役割は問わない）。
 * 画面の担当者選択肢（タスクの担当者・会議の参加者・日程調整の回答者など）と同じ範囲。
 * 1人でも space 外なら断る（呼んだ人に見せてよい理由=404）。
 */
export async function assertUsersAreSpaceMembers(userIds, spaceId) {
    const uniqueIds = Array.from(new Set(userIds));
    if (uniqueIds.length === 0)
        return;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('space_memberships')
        .select('user_id')
        .eq('space_id', spaceId)
        .in('user_id', uniqueIds);
    if (error)
        throw new Error('メンバーの確認に失敗しました');
    const found = new Set((data || []).map((m) => m.user_id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
        throw new ToolUserError('対象のユーザーがこのプロジェクトのメンバーではありません', 404);
    }
}
/**
 * 渡した invite たちが、指定した space の未受諾(accepted_at is null)・期限内(expires_at > now)の
 * 招待であることを確かめる（画面の「招待中の担当者」候補と同じ範囲）。
 * 1人でも該当しなければ断る（呼んだ人に見せてよい理由=404）。
 */
export async function assertInvitesAreInSpace(inviteIds, spaceId) {
    const uniqueIds = Array.from(new Set(inviteIds));
    if (uniqueIds.length === 0)
        return;
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('invites')
        .select('id')
        .eq('space_id', spaceId)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .in('id', uniqueIds);
    if (error)
        throw new Error('招待の確認に失敗しました');
    const found = new Set((data || []).map((r) => r.id));
    const missing = uniqueIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
        throw new ToolUserError('対象の招待が、このプロジェクトの有効な招待ではありません', 404);
    }
}
//# sourceMappingURL=scope.js.map