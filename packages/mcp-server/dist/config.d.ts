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
 * 認証コンテキストを取得
 * 設定されていない場合はデフォルトの全権限コンテキストを返す（開発用）
 */
export declare function getAuthContext(): AuthContext;
//# sourceMappingURL=config.d.ts.map