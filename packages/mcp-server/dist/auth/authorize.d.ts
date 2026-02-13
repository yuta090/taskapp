/**
 * MCP Authorization Module
 *
 * 全てのMCPツールはこのモジュールを通じて権限チェックを行う
 */
export type ActionType = 'read' | 'write' | 'delete' | 'bulk';
export interface AuthContext {
    keyId: string;
    userId: string | null;
    orgId: string;
    scope: 'space' | 'org' | 'user';
    allowedSpaceIds: string[] | null;
    allowedActions: ActionType[];
}
export interface AuthorizeResult {
    allowed: boolean;
    role?: string;
    scope?: string;
    reason: string;
}
export interface AuthorizeParams {
    ctx: AuthContext;
    spaceId: string;
    action: ActionType;
    resourceType?: string;
    resourceId?: string;
}
/**
 * 権限チェックを実行
 * DB側のmcp_authorize関数を呼び出す
 */
export declare function authorize(params: AuthorizeParams): Promise<AuthorizeResult>;
/**
 * 監査ログを記録
 */
export declare function logUsage(params: {
    ctx: AuthContext;
    spaceId: string;
    action: ActionType;
    toolName: string;
    resourceType?: string;
    resourceId?: string;
    success: boolean;
    errorMessage?: string;
    metadata?: Record<string, unknown>;
}): Promise<void>;
/**
 * 権限チェック + 監査ログを一括で行うヘルパー
 */
export declare function authorizeAndLog(params: {
    ctx: AuthContext;
    spaceId: string;
    action: ActionType;
    toolName: string;
    resourceType?: string;
    resourceId?: string;
}): Promise<AuthorizeResult>;
/**
 * 認証コンテキストをAPIキーから作成
 */
export declare function createAuthContext(keyData: {
    key_id: string;
    user_id: string | null;
    org_id: string;
    scope: string;
    allowed_space_ids: string[] | null;
    allowed_actions: string[];
}): AuthContext;
//# sourceMappingURL=authorize.d.ts.map