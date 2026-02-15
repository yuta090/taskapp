import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { config } from '../config.js';
// ── Schemas ──────────────────────────────────────────────
const minutesGetSchema = z.object({
    meetingId: z.string().describe('会議ID'),
});
const minutesUpdateSchema = z.object({
    meetingId: z.string().describe('会議ID'),
    minutesMd: z.string().describe('議事録本文（Markdown）'),
});
const minutesAppendSchema = z.object({
    meetingId: z.string().describe('会議ID'),
    content: z.string().describe('追記する内容（Markdown）'),
});
// ── Helpers ──────────────────────────────────────────────
async function getMeetingScoped(meetingId) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
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
    const meeting = await getMeetingScoped(params.meetingId);
    return {
        meeting_id: meeting.id,
        title: meeting.title,
        status: meeting.status,
        minutes_md: meeting.minutes_md,
    };
}
export async function minutesUpdate(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    // Verify meeting exists and belongs to org/space
    await getMeetingScoped(params.meetingId);
    const { data, error } = await supabase
        .from('meetings')
        .update({ minutes_md: params.minutesMd })
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .select('*')
        .single();
    if (error)
        throw new Error('議事録の更新に失敗しました');
    return data;
}
export async function minutesAppend(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    // Verify meeting exists and belongs to org/space
    const meeting = await getMeetingScoped(params.meetingId);
    // Atomic append using DB-side concatenation via rpc to avoid lost-update race.
    // Falls back to read-then-write if rpc is unavailable.
    let updated;
    try {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('rpc_minutes_append', {
            p_meeting_id: params.meetingId,
            p_org_id: orgId,
            p_space_id: spaceId,
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
        .eq('space_id', spaceId)
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