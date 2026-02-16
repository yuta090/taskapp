import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { config } from '../config.js';
import { checkAuth, checkAuthOrg } from '../auth/helpers.js';
// Schemas
export const spaceCreateSchema = z.object({
    name: z.string().min(1).describe('プロジェクト名'),
    type: z.enum(['project', 'personal']).default('project').describe('タイプ: project=共有, personal=個人'),
});
export const spaceUpdateSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID'),
    name: z.string().min(1).optional().describe('新しいプロジェクト名'),
});
export const spaceListSchema = z.object({
    type: z.enum(['project', 'personal']).optional().describe('タイプでフィルタ'),
});
export const spaceGetSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID'),
});
// Tool implementations
export async function spaceCreate(params) {
    const { ctx } = await checkAuthOrg('write', 'space_create');
    const supabase = getSupabaseClient();
    const orgId = ctx.orgId;
    const { data, error } = await supabase
        .from('spaces')
        .insert({
        org_id: orgId,
        name: params.name,
        type: params.type,
        owner_user_id: params.type === 'personal' ? config.actorId : null,
    })
        .select('*')
        .single();
    if (error)
        throw new Error('プロジェクトの作成に失敗しました: ' + error.message);
    return data;
}
export async function spaceUpdate(params) {
    await checkAuth(params.spaceId, 'write', 'space_update', 'space', params.spaceId);
    const supabase = getSupabaseClient();
    const { data: spaceRow, error: spaceError } = await supabase.from('spaces').select('org_id').eq('id', params.spaceId).single();
    if (spaceError || !spaceRow)
        throw new Error('スペースが見つかりません');
    const orgId = spaceRow.org_id;
    const updateData = {};
    if (params.name !== undefined)
        updateData.name = params.name;
    if (Object.keys(updateData).length === 0) {
        throw new Error('更新するフィールドがありません');
    }
    const { data, error } = await supabase
        .from('spaces')
        .update(updateData)
        .eq('id', params.spaceId)
        .eq('org_id', orgId)
        .select('*')
        .single();
    if (error)
        throw new Error('プロジェクトの更新に失敗しました: ' + error.message);
    return data;
}
export async function spaceList(params) {
    const { ctx } = await checkAuthOrg('read', 'space_list');
    const supabase = getSupabaseClient();
    const orgId = ctx.orgId;
    let query = supabase
        .from('spaces')
        .select('*')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false });
    if (params.type) {
        query = query.eq('type', params.type);
    }
    const { data, error } = await query;
    if (error)
        throw new Error('プロジェクト一覧の取得に失敗しました: ' + error.message);
    return (data || []);
}
export async function spaceGet(params) {
    await checkAuth(params.spaceId, 'read', 'space_get', 'space', params.spaceId);
    const supabase = getSupabaseClient();
    const { data: spaceRow, error: spaceError } = await supabase.from('spaces').select('org_id').eq('id', params.spaceId).single();
    if (spaceError || !spaceRow)
        throw new Error('スペースが見つかりません');
    const orgId = spaceRow.org_id;
    const { data, error } = await supabase
        .from('spaces')
        .select('*')
        .eq('id', params.spaceId)
        .eq('org_id', orgId)
        .single();
    if (error)
        throw new Error('プロジェクトが見つかりません: ' + error.message);
    return data;
}
// Tool definitions for MCP
export const spaceTools = [
    {
        name: 'space_create',
        description: 'プロジェクト新規作成',
        inputSchema: spaceCreateSchema,
        handler: spaceCreate,
    },
    {
        name: 'space_update',
        description: 'プロジェクト名更新',
        inputSchema: spaceUpdateSchema,
        handler: spaceUpdate,
    },
    {
        name: 'space_list',
        description: 'プロジェクト一覧取得。typeフィルタ可',
        inputSchema: spaceListSchema,
        handler: spaceList,
    },
    {
        name: 'space_get',
        description: 'プロジェクト詳細取得',
        inputSchema: spaceGetSchema,
        handler: spaceGet,
    },
];
//# sourceMappingURL=spaces.js.map