import { config as dotenvConfig } from 'dotenv';
import { createAuthContext } from './auth/authorize.js';
import { getSupabaseClient } from './supabase/client.js';
dotenvConfig();
function getEnvOrThrow(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function getEnvOrDefault(key, defaultValue) {
    return process.env[key] || defaultValue;
}
function parseAllowedActions(value) {
    if (!value)
        return ['read'];
    return value.split(',').map(a => a.trim());
}
export function loadConfig() {
    // APIキーが環境変数で設定されている場合は認証コンテキストを作成
    const apiKeyId = process.env.TASKAPP_API_KEY_ID;
    const apiKeyUserId = process.env.TASKAPP_API_KEY_USER_ID;
    const apiKeyScope = process.env.TASKAPP_API_KEY_SCOPE;
    const apiKeyAllowedSpaceIds = process.env.TASKAPP_API_KEY_ALLOWED_SPACE_IDS;
    const apiKeyAllowedActions = process.env.TASKAPP_API_KEY_ALLOWED_ACTIONS;
    let authContext = null;
    if (apiKeyId) {
        authContext = {
            keyId: apiKeyId,
            userId: apiKeyUserId || null,
            orgId: getEnvOrDefault('TASKAPP_ORG_ID', '00000000-0000-0000-0000-000000000001'),
            scope: apiKeyScope || 'space',
            allowedSpaceIds: apiKeyAllowedSpaceIds ? apiKeyAllowedSpaceIds.split(',') : null,
            allowedActions: parseAllowedActions(apiKeyAllowedActions),
        };
    }
    return {
        supabaseUrl: getEnvOrThrow('SUPABASE_URL'),
        supabaseServiceKey: getEnvOrThrow('SUPABASE_SERVICE_KEY'),
        orgId: getEnvOrDefault('TASKAPP_ORG_ID', '00000000-0000-0000-0000-000000000001'),
        spaceId: getEnvOrDefault('TASKAPP_SPACE_ID', '00000000-0000-0000-0000-000000000010'),
        actorId: getEnvOrDefault('TASKAPP_ACTOR_ID', '00000000-0000-0000-0000-000000000099'),
        authContext,
    };
}
export const config = loadConfig();
/**
 * ランタイムAPIキー検証
 * TASKAPP_API_KEY が設定されている場合、DB側の rpc_validate_api_key で検証し
 * 認証コンテキストを動的に設定する
 */
export async function initializeAuth() {
    const apiKey = process.env.TASKAPP_API_KEY;
    if (!apiKey) {
        console.error('WARNING: TASKAPP_API_KEY not set, using static config (dev mode)');
        return;
    }
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.rpc('rpc_validate_api_key', { p_api_key: apiKey });
    if (error || !data || data.length === 0) {
        console.error('FATAL: API key validation failed:', error?.message || 'key not found/expired');
        process.exit(1);
    }
    const row = data[0];
    config.authContext = createAuthContext({
        key_id: row.key_id,
        user_id: row.user_id || null,
        org_id: row.org_id,
        scope: row.scope,
        allowed_space_ids: row.allowed_space_ids || null,
        allowed_actions: row.allowed_actions || ['read'],
    });
    config.orgId = row.org_id;
    if (row.space_id)
        config.spaceId = row.space_id;
    if (row.user_id)
        config.actorId = row.user_id;
    console.error(`Auth initialized: scope=${row.scope}, org=${row.org_id}`);
}
/**
 * 認証コンテキストを取得
 * 設定されていない場合はデフォルトの全権限コンテキストを返す（開発用）
 */
export function getAuthContext() {
    if (config.authContext) {
        return config.authContext;
    }
    // 開発用デフォルト（全権限）
    console.error('WARNING: No auth context configured, using default (full access)');
    return {
        keyId: 'dev-key',
        userId: config.actorId,
        orgId: config.orgId,
        scope: 'space',
        allowedSpaceIds: null,
        allowedActions: ['read', 'write', 'delete', 'bulk'],
    };
}
//# sourceMappingURL=config.js.map