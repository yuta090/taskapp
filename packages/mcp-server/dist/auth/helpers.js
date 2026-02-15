/**
 * 共通認可ヘルパー
 * 全ツールモジュールから使用される checkAuth / checkAuthOrg
 */
import { getAuthContext } from '../config.js';
import { authorizeAndLog, logUsage } from './authorize.js';
/**
 * Space-level 認可チェック
 * DB RPC (mcp_authorize) 経由で細粒度チェック + 監査ログ
 */
export async function checkAuth(spaceId, action, toolName, resourceType, resourceId) {
    const ctx = getAuthContext();
    const result = await authorizeAndLog({
        ctx,
        spaceId,
        action,
        toolName,
        resourceType,
        resourceId,
    });
    if (!result.allowed) {
        throw new Error(`権限エラー: ${result.reason}`);
    }
    return { ctx, role: result.role };
}
/**
 * Org-level 認可チェック
 * ローカルでアクション検証のみ（spaceId不要の操作用）
 */
export async function checkAuthOrg(action, toolName) {
    const ctx = getAuthContext();
    // scope チェック: org-level ツールは org または dev-key のみ許可
    // user/space スコープのキーでは org-wide 操作を禁止
    if (ctx.scope !== 'org' && ctx.keyId !== 'dev-key') {
        throw new Error(`権限エラー: Org-level tool "${toolName}" requires scope=org (current: ${ctx.scope})`);
    }
    if (!ctx.allowedActions.includes(action)) {
        throw new Error(`権限エラー: Action "${action}" not allowed for this API key`);
    }
    // 監査ログ（fire-and-forget、操作の成否は呼び出し元で管理）
    void logUsage({ ctx, spaceId: '', action, toolName, success: true });
    return { ctx };
}
//# sourceMappingURL=helpers.js.map