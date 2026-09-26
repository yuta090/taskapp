/**
 * MCP Authorization Module
 *
 * 全てのMCPツールはこのモジュールを通じて権限チェックを行う
 */
export type ActionType = 'read' | 'write' | 'delete' | 'bulk';
/**
 * change_log トリガー（誰が・どの経路で書いたか。supabase 側 PR #1027）向けの送信元区分。
 * service_role の書き込みで DB がこのヘッダー（x-agentpm-channel）を信用するのは
 * この値の並びだけ（DB側の許可リストと一致させること）。
 */
export type Channel = 'app' | 'cli' | 'mcp' | 'stdio' | 'portal' | 'cron' | 'webhook' | 'connector' | 'admin' | 'system';
export interface AuthContext {
    keyId: string;
    userId: string | null;
    orgId: string;
    scope: 'space' | 'org' | 'user';
    /** scope=space の鍵（プロジェクト設定で作った鍵）が属するプロジェクト。取れなければ null */
    spaceId?: string | null;
    allowedSpaceIds: string[] | null;
    allowedActions: ActionType[];
    /** どの受け口で認証したか（CLI / MCP / stdio）。API キーの行データには無いので必ず呼び出し元が渡す */
    channel: Channel;
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
    space_id?: string | null;
}, channel: Channel): AuthContext;
//# sourceMappingURL=authorize.d.ts.map