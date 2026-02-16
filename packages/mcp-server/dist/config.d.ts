import type { AuthContext } from './auth/authorize.js';
export interface McpServerConfig {
    supabaseUrl: string;
    supabaseServiceKey: string;
    orgId: string;
    spaceId: string;
    actorId: string;
    authContext: AuthContext | null;
}
export declare function loadConfig(): McpServerConfig;
export declare const config: McpServerConfig;
/**
 * ランタイムAPIキー検証
 * TASKAPP_API_KEY が設定されている場合、DB側の rpc_validate_api_key で検証し
 * 認証コンテキストを動的に設定する
 */
export declare function initializeAuth(): Promise<void>;
/**
 * 認証コンテキストを取得
 * 設定されていない場合はデフォルトの全権限コンテキストを返す（開発用）
 */
export declare function getAuthContext(): AuthContext;
//# sourceMappingURL=config.d.ts.map