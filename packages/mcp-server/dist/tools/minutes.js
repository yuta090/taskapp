import { z } from 'zod';
import { assertWriteApplied } from '../lib/staleWrite.js';
import { getSupabaseClient } from '../supabase/client.js';
import { checkAuth } from '../auth/helpers.js';
// ── Schemas ──────────────────────────────────────────────
const minutesGetSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    meetingId: z.string().describe('会議ID'),
});
const minutesUpdateSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    meetingId: z.string().describe('会議ID'),
    minutesMd: z.string().describe('議事録本文（Markdown）'),
    expectedUpdatedAt: z
        .string()
        .optional()
        .describe('直前の minutes_get で受け取った updated_at をそのまま渡す。渡すと、その版のままのときだけ書き換える。渡さないと、他の人やAIが先に書いた内容を黙って上書きする（議事録には控えが無く元に戻せない）'),
});
const minutesAppendSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    meetingId: z.string().describe('会議ID'),
    content: z.string().describe('追記する内容（Markdown）'),
});
// ── Helpers ──────────────────────────────────────────────
async function getOrgId(spaceId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single();
    if (error || !data)
        throw new Error('スペースが見つかりません');
    return data.org_id;
}
async function getMeetingScoped(meetingId, spaceId, orgId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', meetingId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .single();
    if (error || !data)
        throw new Error('会議が見つかりません');
    return data;
}
// ── Handlers ─────────────────────────────────────────────
export async function minutesGet(params) {
    await checkAuth(params.spaceId, 'read', 'minutes_get', 'meeting', params.meetingId);
    const orgId = await getOrgId(params.spaceId);
    const meeting = await getMeetingScoped(params.meetingId, params.spaceId, orgId);
    return {
        meeting_id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        minutes_md: meeting.minutes_md,
        // 書き換えるときに expectedUpdatedAt として渡すための版。これが無いと
        // 「先に誰かが書いていたら断る」を使いたくても値が取れない
        updated_at: meeting.updated_at,
    };
}
export async function minutesUpdate(params) {
    await checkAuth(params.spaceId, 'write', 'minutes_update', 'meeting', params.meetingId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    // Verify meeting exists and belongs to org/space
    await getMeetingScoped(params.meetingId, params.spaceId, orgId);
    // expectedUpdatedAt を渡されたときだけ、その版のままの行に限って書く（楽観ロック）。
    // .single() は使わない — 0行のとき例外になり、競合と「見つからない」を区別できないため。
    let query = supabase
        .from('meetings')
        .update({ minutes_md: params.minutesMd })
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId);
    if (params.expectedUpdatedAt !== undefined) {
        query = query.eq('updated_at', params.expectedUpdatedAt);
    }
    const { data, error } = await query.select('*');
    if (error)
        throw new Error('議事録の更新に失敗しました');
    const rows = (data ?? []);
    assertWriteApplied(rows.length, params.expectedUpdatedAt, '会議が見つかりません');
    return rows[0];
}
export async function minutesAppend(params) {
    await checkAuth(params.spaceId, 'write', 'minutes_append', 'meeting', params.meetingId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    // Verify meeting exists and belongs to org/space
    const meeting = await getMeetingScoped(params.meetingId, params.spaceId, orgId);
    // Atomic append using DB-side concatenation via rpc to avoid lost-update race.
    // Falls back to read-then-write if rpc is unavailable.
    let updated;
    try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_minutes_append', {
            p_meeting_id: params.meetingId,
            p_org_id: orgId,
            p_space_id: params.spaceId,
            p_content: params.content,
        });
        if (!rpcError && rpcResult) {
            // RPC returns the updated meeting row
            return rpcResult;
        }
        // RPC not available — fall back to read-then-write
        const current = meeting.minutes_md || '';
        updated = current ? `${current}\n\n${params.content}` : params.content;
    }
    catch {
        // RPC not available — fall back to read-then-write
        const current = meeting.minutes_md || '';
        updated = current ? `${current}\n\n${params.content}` : params.content;
    }
    const { data, error } = await supabase
        .from('meetings')
        .update({ minutes_md: updated })
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .select('*')
        .single();
    if (error)
        throw new Error('議事録の追記に失敗しました');
    return data;
}
// ── Tool definitions ─────────────────────────────────────
export const minutesTools = [
    {
        name: 'minutes_get',
        description: '議事録取得(minutes_md)',
        inputSchema: minutesGetSchema,
        handler: minutesGet,
    },
    {
        name: 'minutes_update',
        description: '議事録上書き更新',
        inputSchema: minutesUpdateSchema,
        handler: minutesUpdate,
    },
    {
        name: 'minutes_append',
        description: '議事録末尾追記',
        inputSchema: minutesAppendSchema,
        handler: minutesAppend,
    },
];
//# sourceMappingURL=minutes.js.map