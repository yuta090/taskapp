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
//# sourceMappingURL=scope.js.map