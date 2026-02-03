import { z } from 'zod';
import { getSupabaseClient } from '../supabase/client.js';
import { config } from '../config.js';
// Schemas
export const activityLogSchema = z.object({
    entityTable: z.string().describe('対象テーブル名 (tasks, milestones, etc.)'),
    entityId: z.string().uuid().describe('対象レコードのUUID'),
    action: z.string().describe('アクション (insert, update, delete, etc.)'),
    actorType: z.enum(['user', 'system', 'ai', 'service']).default('ai').describe('アクタータイプ'),
    actorService: z.string().optional().describe('サービス名 (MCP/Claude/GPT等)'),
    requestId: z.string().uuid().optional().describe('リクエストID（相関用）'),
    sessionId: z.string().uuid().optional().describe('セッションID（相関用）'),
    entityDisplay: z.string().optional().describe('表示用の名前'),
    reason: z.string().optional().describe('変更理由/AIの意図'),
    status: z.enum(['ok', 'error', 'warning']).default('ok').describe('ステータス'),
    changedFields: z.array(z.string()).optional().describe('変更されたフィールド名'),
    beforeData: z.record(z.unknown()).optional().describe('変更前データ'),
    afterData: z.record(z.unknown()).optional().describe('変更後データ'),
    payload: z.record(z.unknown()).optional().describe('追加メタ情報'),
});
export const activitySearchSchema = z.object({
    entityTable: z.string().optional().describe('テーブル名でフィルタ'),
    entityId: z.string().uuid().optional().describe('エンティティIDでフィルタ'),
    actorId: z.string().uuid().optional().describe('アクターIDでフィルタ'),
    action: z.string().optional().describe('アクションでフィルタ'),
    from: z.string().optional().describe('開始日時 (ISO8601)'),
    to: z.string().optional().describe('終了日時 (ISO8601)'),
    sessionId: z.string().uuid().optional().describe('セッションIDでフィルタ'),
    limit: z.number().min(1).max(500).default(100).describe('取得件数'),
});
export const activityEntityHistorySchema = z.object({
    entityTable: z.string().describe('テーブル名'),
    entityId: z.string().uuid().describe('エンティティID'),
    limit: z.number().min(1).max(100).default(50).describe('取得件数'),
});
// Tool implementations
export async function activityLog(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    const { data, error } = await supabase
        .from('activity_log')
        .insert({
        actor_id: config.actorId,
        actor_type: params.actorType,
        actor_service: params.actorService || 'MCP',
        request_id: params.requestId || null,
        session_id: params.sessionId || null,
        entity_table: params.entityTable,
        entity_id: params.entityId,
        entity_display: params.entityDisplay || null,
        action: params.action,
        reason: params.reason || null,
        status: params.status,
        changed_fields: params.changedFields || null,
        before_data: params.beforeData || null,
        after_data: params.afterData || null,
        payload: params.payload || {},
        organization_id: orgId,
        space_id: spaceId,
    })
        .select('id')
        .single();
    if (error)
        throw new Error('アクティビティログの記録に失敗しました: ' + error.message);
    return { id: data.id };
}
export async function activitySearch(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const spaceId = config.spaceId;
    let query = supabase
        .from('activity_log')
        .select('*')
        .eq('organization_id', orgId)
        .eq('space_id', spaceId)
        .eq('is_deleted', false)
        .order('occurred_at', { ascending: false })
        .limit(params.limit);
    if (params.entityTable) {
        query = query.eq('entity_table', params.entityTable);
    }
    if (params.entityId) {
        query = query.eq('entity_id', params.entityId);
    }
    if (params.actorId) {
        query = query.eq('actor_id', params.actorId);
    }
    if (params.action) {
        query = query.eq('action', params.action);
    }
    if (params.sessionId) {
        query = query.eq('session_id', params.sessionId);
    }
    if (params.from) {
        query = query.gte('occurred_at', params.from);
    }
    if (params.to) {
        query = query.lte('occurred_at', params.to);
    }
    const { data, error } = await query;
    if (error)
        throw new Error('アクティビティログの検索に失敗しました: ' + error.message);
    return (data || []);
}
export async function activityEntityHistory(params) {
    const supabase = getSupabaseClient();
    const orgId = config.orgId;
    const { data, error } = await supabase
        .from('activity_log')
        .select('*')
        .eq('organization_id', orgId)
        .eq('entity_table', params.entityTable)
        .eq('entity_id', params.entityId)
        .eq('is_deleted', false)
        .order('occurred_at', { ascending: false })
        .limit(params.limit);
    if (error)
        throw new Error('エンティティ履歴の取得に失敗しました: ' + error.message);
    return (data || []);
}
// Tool definitions for MCP
export const activityTools = [
    {
        name: 'activity_log',
        description: 'アクティビティログを記録します。AIの操作履歴を追跡可能にします。',
        inputSchema: activityLogSchema,
        handler: activityLog,
    },
    {
        name: 'activity_search',
        description: 'アクティビティログを検索します。テーブル、アクター、アクション、期間等でフィルタ可能。',
        inputSchema: activitySearchSchema,
        handler: activitySearch,
    },
    {
        name: 'activity_entity_history',
        description: '特定エンティティの変更履歴を取得します。デバッグ・トラブルシューティング用。',
        inputSchema: activityEntityHistorySchema,
        handler: activityEntityHistory,
    },
];
//# sourceMappingURL=activity.js.map