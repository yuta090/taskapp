/**
 * Dry Run / Confirm Module
 *
 * 破壊的操作の2段階確認を提供
 */
import { getSupabaseClient } from '../supabase/client.js';
/**
 * 削除のdry runを実行
 * 実際には削除せず、影響件数と確認トークンを返す
 */
export async function dryRunDelete(params) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('mcp_dry_run_delete', {
        p_key_id: params.ctx.keyId,
        p_space_id: params.spaceId,
        p_resource_type: params.resourceType,
        p_resource_ids: params.resourceIds,
    });
    if (error) {
        return {
            success: false,
            dryRun: true,
            affectedCount: 0,
            resourceType: params.resourceType,
            resourceIds: params.resourceIds,
            confirmToken: '',
            expiresInSeconds: 0,
            message: '',
            error: error.message,
        };
    }
    return {
        success: data.success,
        dryRun: true,
        affectedCount: data.affected_count,
        resourceType: data.resource_type,
        resourceIds: data.resource_ids,
        confirmToken: data.confirm_token,
        expiresInSeconds: data.expires_in_seconds,
        message: data.message,
        error: data.error,
    };
}
/**
 * 確認トークンを使用して実際の削除を実行
 */
export async function confirmDelete(params) {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('mcp_confirm_delete', {
        p_key_id: params.ctx.keyId,
        p_confirm_token: params.confirmToken,
    });
    if (error) {
        return {
            success: false,
            error: error.message,
        };
    }
    return {
        success: data.success,
        deletedCount: data.deleted_count,
        resourceType: data.resource_type,
        error: data.error,
    };
}
//# sourceMappingURL=dryrun.js.map