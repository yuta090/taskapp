import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { checkAuth } from '../auth/helpers.js';
/**
 * file_* — プロジェクトのファイル（`agentpm file list / upload` の実体）。
 *
 * アップロードは Web(FilesPageClient)と同じ 3 段階:
 *   1. file_upload_url  … files に pending 行を作り、Storage の署名アップロードURLを返す
 *   2. （CLI が署名URLへ実バイトを PUT する。API サーバーはバイトを通さない）
 *   3. file_upload_complete … Storage に実体があることを確認して status='ready' にする
 * サーバーがバイトを中継しないので、関数の応答/要求サイズ上限(4.5MB)に縛られず 50MB まで送れる。
 *
 * - 認可は checkAuth（space 単位）。client/vendor 権限のキーは Web と同じく origin='client' を強制。
 * - uploaded_by は API キーに紐づく利用者。紐づいていないキー(user_id NULL)では作れない。
 */
/** Web 側(src/app/api/files/upload-url/route.ts)と同じ上限 */
export const MAX_FILE_SIZE_BYTES = 52428800;
const MAX_NAME_LENGTH = 255;
const BUCKET = 'space-files';
const TABULAR_EXTENSIONS = ['.csv', '.tsv'];
const fileListSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    limit: z.number().int().positive().max(200).default(50).describe('取得件数上限'),
});
const fileUploadUrlSchema = z.object({
    spaceId: z.string().uuid().describe('アップロード先スペースUUID（必須）'),
    name: z.string().min(1).max(MAX_NAME_LENGTH).describe('ファイル名（パス区切り不可）'),
    mimeType: z.string().max(255).optional().describe('MIME タイプ（省略時 application/octet-stream）'),
    sizeBytes: z.number().int().positive().describe('ファイルサイズ（バイト・50MB まで）'),
});
const fileUploadCompleteSchema = z.object({
    spaceId: z.string().uuid().describe('スペースUUID（必須）'),
    fileId: z.string().uuid().describe('file_upload_url が返した fileId'),
});
async function getOrgId(spaceId) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('spaces').select('org_id').eq('id', spaceId).single();
    if (error || !data)
        throw new Error('スペースが見つかりません');
    return data.org_id;
}
function isClientRole(role) {
    return role === 'client' || role === 'vendor';
}
/** パス区切りと、署名URLに載せると Storage 側でパスがずれる文字 */
const FORBIDDEN_NAME_CHARS = ['/', '\\', '#', '?'];
function isTabularName(name) {
    const lower = name.toLowerCase();
    return TABULAR_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
export async function fileList(params) {
    const { ctx, role } = await checkAuth(params.spaceId, 'read', 'file_list', 'file');
    const supabase = getSupabaseClient();
    let query = supabase
        .from('files')
        .select('id, name, mime_type, size_bytes, origin, client_visible, status, created_at')
        .eq('space_id', params.spaceId)
        .eq('status', 'ready');
    // service role は RLS を通らないため、Web と同じ見える範囲(files の SELECT ポリシー)をここで付け直す:
    // client/vendor はクライアント公開のものと自分がアップロードしたものだけ
    if (isClientRole(role)) {
        query = query.or(`client_visible.eq.true,uploaded_by.eq.${ctx.userId ?? '00000000-0000-0000-0000-000000000000'}`);
    }
    const { data, error } = await query.order('created_at', { ascending: false }).limit(params.limit);
    if (error)
        throw new Error('ファイル一覧の取得に失敗しました');
    return (data || [])
        .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mime_type,
        sizeBytes: Number(f.size_bytes),
        origin: f.origin,
        clientVisible: Boolean(f.client_visible),
        createdAt: f.created_at,
        downloadPath: `/api/files/${f.id}/download`,
    }));
}
export async function fileUploadUrl(params) {
    const { ctx, role } = await checkAuth(params.spaceId, 'write', 'file_upload_url', 'file');
    if (FORBIDDEN_NAME_CHARS.some((c) => params.name.includes(c))) {
        throw new Error('ファイル名に / \\ # ? は使えません');
    }
    if (params.sizeBytes > MAX_FILE_SIZE_BYTES) {
        throw new Error('ファイルが 50MB を超えています');
    }
    // config.actorId はリクエストをまたいで残るグローバルなので使わない(前の利用者IDが混ざる)。鍵に紐づく利用者だけ
    const uploadedBy = ctx.userId;
    if (!uploadedBy) {
        throw new Error('この API キーには利用者が紐づいていないためアップロードできません');
    }
    const supabase = getSupabaseClient();
    const orgId = await getOrgId(params.spaceId);
    // client/vendor がアップロードする場合は Web と同じく origin='client' かつ client_visible=true を強制
    // 現状 mcp_authorize は client/vendor の write を file に許可しないためここには来ないが、Web と同じ強制を防御として残す
    const clientRole = isClientRole(role);
    const fileId = randomUUID();
    const storagePath = `${params.spaceId}/${fileId}/${params.name}`;
    const { data: row, error: insertError } = await supabase
        .from('files')
        .insert({
        id: fileId,
        org_id: orgId,
        space_id: params.spaceId,
        uploaded_by: uploadedBy,
        origin: clientRole ? 'client' : 'internal',
        client_visible: clientRole,
        name: params.name,
        mime_type: params.mimeType || 'application/octet-stream',
        size_bytes: params.sizeBytes,
        storage_path: storagePath,
        status: 'pending',
    })
        .select('id')
        .single();
    if (insertError || !row) {
        // 生の DB エラー文(制約名など)は外に出さない(Web の upload-url route と同じ)
        console.error('file_upload_url insert error:', insertError);
        throw new Error('ファイルの登録に失敗しました');
    }
    const { data: signed, error: signedError } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath);
    if (signedError || !signed) {
        // 署名URLが出せない行は誰もアップロードできないので消す（ベストエフォート）
        await supabase.from('files').delete().eq('id', fileId);
        throw new Error('アップロード用URLの発行に失敗しました');
    }
    return {
        fileId,
        signedUrl: signed.signedUrl,
        token: signed.token,
        path: storagePath,
        maxBytes: MAX_FILE_SIZE_BYTES,
    };
}
export async function fileUploadComplete(params) {
    const { ctx } = await checkAuth(params.spaceId, 'write', 'file_upload_complete', 'file', params.fileId);
    const supabase = getSupabaseClient();
    const { data: file, error } = await supabase
        .from('files')
        .select('id, org_id, space_id, uploaded_by, name, storage_path, status')
        .eq('id', params.fileId)
        .eq('space_id', params.spaceId)
        .single();
    if (error || !file)
        throw new Error('ファイルが見つかりません');
    if (!ctx.userId || file.uploaded_by !== ctx.userId) {
        throw new Error('権限エラー: 自分がアップロードしたファイルだけ完了にできます');
    }
    const downloadPath = `/api/files/${file.id}/download`;
    const tablePath = isTabularName(file.name)
        ? `/${file.org_id}/project/${file.space_id}/files/${file.id}`
        : null;
    // 二重実行しても副作用が増えないよう、既に ready なら何もしない
    if (file.status === 'ready') {
        return { ok: true, fileId: file.id, name: file.name, downloadPath, tablePath, message: 'すでにアップロード済みです' };
    }
    const storagePath = file.storage_path;
    const lastSlash = storagePath.lastIndexOf('/');
    const folder = storagePath.slice(0, lastSlash);
    const fileName = storagePath.slice(lastSlash + 1);
    const { data: listing, error: listError } = await supabase.storage.from(BUCKET).list(folder);
    if (listError)
        throw new Error('アップロードの確認に失敗しました');
    const exists = (listing || []).some((entry) => entry.name === fileName);
    if (!exists)
        throw new Error('アップロードが完了していません（Storage にファイルがありません）');
    const { error: updateError } = await supabase.from('files').update({ status: 'ready' }).eq('id', params.fileId);
    if (updateError)
        throw new Error('ファイルの完了処理に失敗しました');
    // Web の complete route は origin='client' のとき内部メンバーへ通知するが、CLI 経路は現状 client ロールの
    // write が認可されず origin='client' にならないため省略している。client 経路を開くときはここに通知を足す
    return { ok: true, fileId: file.id, name: file.name, downloadPath, tablePath, message: 'アップロードが完了しました' };
}
export const fileTools = [
    {
        name: 'file_list',
        description: 'スペースのファイル一覧を取得する（アップロード完了済みのみ・新しい順）。spaceId 必須',
        inputSchema: fileListSchema,
        handler: fileList,
    },
    {
        name: 'file_upload_url',
        description: 'ファイルのアップロードを開始する。files に pending 行を作り、Storage への署名アップロードURLを返す。実バイトは署名URLへ PUT し、その後 file_upload_complete を呼ぶ。spaceId・name・sizeBytes 必須（50MB まで）',
        inputSchema: fileUploadUrlSchema,
        handler: fileUploadUrl,
    },
    {
        name: 'file_upload_complete',
        description: 'アップロード完了を確定する。Storage に実体があることを確認して status=ready にする。spaceId・fileId（file_upload_url の戻り値）必須。再実行しても副作用なし',
        inputSchema: fileUploadCompleteSchema,
        handler: fileUploadComplete,
    },
];
//# sourceMappingURL=files.js.map