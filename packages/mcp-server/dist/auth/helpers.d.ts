/**
 * 共通認可ヘルパー
 * 全ツールモジュールから使用される checkAuth / checkAuthOrg
 */
import { getAuthContext } from '../config.js';
import { type ActionType } from './authorize.js';
/**
 * Space-level 認可チェック
 * DB RPC (mcp_authorize) 経由で細粒度チェック + 監査ログ
 */
export declare function checkAuth(spaceId: string, action: ActionType, toolName: string, resourceType: string, resourceId?: string): Promise<{
    ctx: ReturnType<typeof getAuthContext>;
    role?: string;
}>;
/**
 * Org-level 認可チェック
 * ローカルでアクション検証のみ（spaceId不要の操作用）
 */
export declare function checkAuthOrg(action: ActionType, toolName: string): Promise<{
    ctx: ReturnType<typeof getAuthContext>;
}>;
//# sourceMappingURL=helpers.d.ts.map