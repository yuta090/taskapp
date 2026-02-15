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
export const meetingCreateSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    title: z.string().min(1).describe('会議タイトル'),
    heldAt: z.string().optional().describe('開催日時 (ISO8601)'),
    notes: z.string().optional().describe('事前メモ'),
    participantIds: z.array(z.string().uuid()).default([]).describe('参加者UUID配列'),
});
export const meetingStartSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    meetingId: z.string().uuid().describe('会議UUID'),
});
export const meetingEndSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    meetingId: z.string().uuid().describe('会議UUID'),
});
export const meetingListSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    status: z.enum(['planned', 'in_progress', 'ended']).optional().describe('ステータスでフィルタ'),
    limit: z.number().min(1).max(100).default(20).describe('取得件数'),
});
export const meetingGetSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    meetingId: z.string().uuid().describe('会議UUID'),
});
// Tool implementations
export async function meetingCreate(params) {
    await checkAuth(params.spaceId, 'write', 'meeting_create', 'meeting');
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: meeting, error } = await supabase
        .from('meetings')
        .insert({
        org_id: orgId,
        space_id: params.spaceId,
        title: params.title,
        held_at: params.heldAt || null,
        notes: params.notes || null,
        status: 'planned',
    })
        .select('*')
        .single();
    if (error)
        throw new Error('会議の作成に失敗しました');
    if (params.participantIds.length > 0) {
        const participantRows = params.participantIds.map((userId) => ({
            org_id: orgId,
            space_id: params.spaceId,
            meeting_id: meeting.id,
            user_id: userId,
            side: 'internal',
        }));
        const { error: participantError } = await supabase
            .from('meeting_participants')
            .insert(participantRows);
        if (participantError) {
            console.error('参加者登録失敗:', participantError.message);
        }
    }
    return meeting;
}
export async function meetingStart(params) {
    await checkAuth(params.spaceId, 'write', 'meeting_start', 'meeting', params.meetingId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: existingMeeting, error: checkError } = await supabase
        .from('meetings')
        .select('id')
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (checkError || !existingMeeting) {
        throw new Error('会議が見つかりません');
    }
    const { error } = await supabase.rpc('rpc_meeting_start', {
        p_meeting_id: params.meetingId,
    });
    if (error)
        throw new Error('会議の開始に失敗しました');
    const { data: meeting, error: meetingError } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (meetingError)
        throw new Error('会議が見つかりません');
    return { ok: true, meeting: meeting };
}
export async function meetingEnd(params) {
    await checkAuth(params.spaceId, 'write', 'meeting_end', 'meeting', params.meetingId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: existingMeeting, error: checkError } = await supabase
        .from('meetings')
        .select('id')
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (checkError || !existingMeeting) {
        throw new Error('会議が見つかりません');
    }
    const { data, error } = await supabase.rpc('rpc_meeting_end', {
        p_meeting_id: params.meetingId,
    });
    if (error)
        throw new Error('会議の終了に失敗しました');
    const { data: meeting, error: meetingError } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (meetingError)
        throw new Error('会議が見つかりません');
    return {
        ok: true,
        meeting: meeting,
        summary: {
            subject: data?.summary_subject || '',
            body: data?.summary_body || '',
            counts: data?.counts || { decided: 0, open: 0, ball_client: 0 },
        },
    };
}
export async function meetingList(params) {
    await checkAuth(params.spaceId, 'read', 'meeting_list', 'meeting');
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    let query = supabase
        .from('meetings')
        .select('*')
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .order('held_at', { ascending: false, nullsFirst: false })
        .limit(params.limit);
    if (params.status) {
        query = query.eq('status', params.status);
    }
    const { data, error } = await query;
    if (error)
        throw new Error('会議一覧の取得に失敗しました');
    return (data || []);
}
export async function meetingGet(params) {
    await checkAuth(params.spaceId, 'read', 'meeting_get', 'meeting', params.meetingId);
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    const { data: meeting, error: meetingError } = await supabase
        .from('meetings')
        .select('*')
        .eq('id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId)
        .single();
    if (meetingError)
        throw new Error('会議が見つかりません');
    const { data: participants, error: participantsError } = await supabase
        .from('meeting_participants')
        .select('user_id, side')
        .eq('meeting_id', params.meetingId)
        .eq('org_id', orgId)
        .eq('space_id', params.spaceId);
    if (participantsError)
        throw new Error('参加者の取得に失敗しました');
    return {
        meeting: meeting,
        participants: participants || [],
    };
}
// Tool definitions for MCP
export const meetingTools = [
    {
        name: 'meeting_create',
        description: '会議新規作成',
        inputSchema: meetingCreateSchema,
        handler: meetingCreate,
    },
    {
        name: 'meeting_start',
        description: '会議開始(planned→in_progress)',
        inputSchema: meetingStartSchema,
        handler: meetingStart,
    },
    {
        name: 'meeting_end',
        description: '会議終了+自動サマリー生成',
        inputSchema: meetingEndSchema,
        handler: meetingEnd,
    },
    {
        name: 'meeting_list',
        description: '会議一覧取得。statusフィルタ可',
        inputSchema: meetingListSchema,
        handler: meetingList,
    },
    {
        name: 'meeting_get',
        description: '会議詳細+参加者取得',
        inputSchema: meetingGetSchema,
        handler: meetingGet,
    },
];
//# sourceMappingURL=meetings.js.map