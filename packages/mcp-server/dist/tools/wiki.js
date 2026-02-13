import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { config } from '../config.js';
// ── Schemas ──────────────────────────────────────────────
const wikiListSchema = z.object({
    spaceId: z.string().optional().describe('スペースID（省略時はデフォルト）'),
    limit: z.number().int().positive().max(200).default(50).describe('取得件数上限'),
});
const wikiGetSchema = z.object({
    pageId: z.string().describe('WikiページID'),
});
const wikiCreateSchema = z.object({
    title: z.string().describe('ページタイトル'),
    body: z.string().optional().describe('ページ本文（Markdown）'),
    tags: z.array(z.string()).optional().describe('タグ配列'),
});
const wikiUpdateSchema = z.object({
    pageId: z.string().describe('WikiページID'),
    title: z.string().optional().describe('タイトル'),
    body: z.string().optional().describe('本文（Markdown）'),
    tags: z.array(z.string()).optional().describe('タグ配列'),
});
const wikiDeleteSchema = z.object({
    pageId: z.string().describe('WikiページID'),
});
const wikiVersionsSchema = z.object({
    pageId: z.string().describe('WikiページID'),
    limit: z.number().int().positive().max(100).default(20).describe('取得件数上限'),
});
// ── Handlers ─────────────────────────────────────────────
export async function wikiList(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = params.spaceId || config.spaceId;
    const { data, error } = await supabase
        .from('wiki_pages')
        .select('id, org_id, space_id, title, tags, created_by, updated_by, created_at, updated_at')
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .order('updated_at', { ascending: false })
        .limit(params.limit);
    if (error)
        throw new Error('Wikiページ一覧の取得に失敗しました');
    return (data || []);
}
export async function wikiGet(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    const { data, error } = await supabase
        .from('wiki_pages')
        .select('*')
        .eq('id', params.pageId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .single();
    if (error)
        throw new Error('Wikiページが見つかりません');
    return data;
}
export async function wikiCreate(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    const actorId = config.actorId;
    const { data, error } = await supabase
        .from('wiki_pages')
        .insert({
        org_id: orgId,
        space_id: spaceId,
        title: params.title,
        body: params.body || '',
        tags: params.tags || [],
        created_by: actorId,
        updated_by: actorId,
    })
        .select('*')
        .single();
    if (error)
        throw new Error('Wikiページの作成に失敗しました');
    return data;
}
export async function wikiUpdate(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    const actorId = config.actorId;
    // Build update payload
    const updateData = { updated_by: actorId };
    if (params.title !== undefined)
        updateData.title = params.title;
    if (params.body !== undefined)
        updateData.body = params.body;
    if (params.tags !== undefined)
        updateData.tags = params.tags;
    const { data, error } = await supabase
        .from('wiki_pages')
        .update(updateData)
        .eq('id', params.pageId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId)
        .select('*')
        .single();
    if (error)
        throw new Error('Wikiページの更新に失敗しました');
    // Save version snapshot when body changes
    if (params.body !== undefined) {
        const { error: vErr } = await supabase
            .from('wiki_page_versions')
            .insert({
            org_id: orgId,
            page_id: params.pageId,
            title: data.title,
            body: params.body,
            created_by: actorId,
        });
        if (vErr)
            console.error('バージョン保存失敗:', vErr.message);
    }
    return data;
}
export async function wikiDelete(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    const { error } = await supabase
        .from('wiki_pages')
        .delete()
        .eq('id', params.pageId)
        .eq('org_id', orgId)
        .eq('space_id', spaceId);
    if (error)
        throw new Error('Wikiページの削除に失敗しました');
    return { ok: true };
}
export async function wikiVersions(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const { data, error } = await supabase
        .from('wiki_page_versions')
        .select('*')
        .eq('page_id', params.pageId)
        .eq('org_id', orgId)
        .order('created_at', { ascending: false })
        .limit(params.limit);
    if (error)
        throw new Error('バージョン履歴の取得に失敗しました');
    return (data || []);
}
// ── Tool definitions ─────────────────────────────────────
export const wikiTools = [
    {
        name: 'wiki_list',
        description: 'Wikiページ一覧を取得します。タイトル・タグ情報のみ（本文は含まない）。',
        inputSchema: wikiListSchema,
        handler: wikiList,
    },
    {
        name: 'wiki_get',
        description: 'Wikiページの詳細（本文含む）を取得します。',
        inputSchema: wikiGetSchema,
        handler: wikiGet,
    },
    {
        name: 'wiki_create',
        description: '新しいWikiページを作成します。',
        inputSchema: wikiCreateSchema,
        handler: wikiCreate,
    },
    {
        name: 'wiki_update',
        description: 'Wikiページを更新します。本文変更時はバージョン履歴も自動保存。',
        inputSchema: wikiUpdateSchema,
        handler: wikiUpdate,
    },
    {
        name: 'wiki_delete',
        description: 'Wikiページを削除します。',
        inputSchema: wikiDeleteSchema,
        handler: wikiDelete,
    },
    {
        name: 'wiki_versions',
        description: 'Wikiページのバージョン履歴を取得します。',
        inputSchema: wikiVersionsSchema,
        handler: wikiVersions,
    },
];
//# sourceMappingURL=wiki.js.map