/**
 * MCP Authorization Module
 *
 * 全てのMCPツールはこのモジュールを通じて権限チェックを行う
 */
import { getSupabaseClient } from '../supabase/client.js';
/**
 * 権限チェックを実行
 * DB側のmcp_authorize関数を呼び出す
 */
export async function authorize(params) {
    const { ctx, spaceId, action, resourceType, resourceId } = params;
    const supabase = getSupabaseClient();
    // space_idが必須（横断アクセスでも操作対象は明示）
    if (!spaceId) {
        return {
            allowed: false,
            reason: 'space_id is required for all operations'
        };
    }
    // アクションがAPIキーで許可されているかローカルチェック
    if (!ctx.allowedActions.includes(action)) {
        return {
            allowed: false,
            reason: `Action "${action}" not allowed for this API key`
        };
    }
    // scope='user'でallowed_space_idsが設定されている場合のローカルチェック
    if (ctx.scope === 'user' && ctx.allowedSpaceIds && !ctx.allowedSpaceIds.includes(spaceId)) {
        return {
            allowed: false,
            reason: 'Space not in allowed_space_ids'
        };
    }
    // DB側で詳細な権限チェック
    const { data, error } = await supabase.rpc('mcp_authorize', {
        p_key_id: ctx.keyId,
        p_user_id: ctx.userId,
        p_space_id: spaceId,
        p_action: action,
        p_resource_type: resourceType || null,
        p_resource_id: resourceId || null,
    });
    if (error) {
        console.error('Authorization error:', error);
        return {
            allowed: false,
            reason: `Authorization failed: ${error.message}`
        };
    }
    return data;
}
/**
 * 監査ログを記録
 */
export async function logUsage(params) {
    const supabase = getSupabaseClient();
    try {
        await supabase.rpc('mcp_log_usage', {
            p_key_id: params.ctx.keyId,
            p_user_id: params.ctx.userId,
            p_space_id: params.spaceId,
            p_action: params.action,
            p_tool_name: params.toolName,
            p_resource_type: params.resourceType || null,
            p_resource_id: params.resourceId || null,
            p_success: params.success,
            p_error_message: params.errorMessage || null,
            p_metadata: params.metadata || {},
        });
    }
    catch (err) {
        // 監査ログの失敗は操作をブロックしない
        console.error('Failed to log usage:', err);
    }
}
/**
 * 権限チェック + 監査ログを一括で行うヘルパー
 */
export async function authorizeAndLog(params) {
    const result = await authorize({
        ctx: params.ctx,
        spaceId: params.spaceId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
    });
    // 監査ログを非同期で記録（結果を待たない）
    void logUsage({
        ctx: params.ctx,
        spaceId: params.spaceId,
        action: params.action,
        toolName: params.toolName,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        success: result.allowed,
        errorMessage: result.allowed ? undefined : result.reason,
    });
    return result;
}
/**
 * 認証コンテキストをAPIキーから作成
 */
export function createAuthContext(keyData) {
    return {
        keyId: keyData.key_id,
        userId: keyData.user_id,
        orgId: keyData.org_id,
        scope: keyData.scope,
        allowedSpaceIds: keyData.allowed_space_ids,
        allowedActions: keyData.allowed_actions,
    };
}
//# sourceMappingURL=authorize.js.map