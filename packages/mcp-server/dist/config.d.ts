import type { AuthContext, ActionType } from './auth/authorize.js';
export interface McpServerConfig {
    supabaseUrl: string;
    supabaseServiceKey: string;
    /** stdio モードの既定プロジェクト（TASKAPP_SPACE_ID）。HTTP では使わない */
    spaceId: string;
}
declare function parseAllowedActions(value: string | undefined): ActionType[];
export declare function loadConfig(): McpServerConfig;
export declare const config: McpServerConfig;
/** この呼び出しのあいだだけ ctx を有効にしてツールを実行する。ツール実行の唯一の入口 */
export declare function runWithAuthContext<T>(ctx: AuthContext, fn: () => Promise<T>): Promise<T>;
/**
 * 認証コンテキストを取得。
 * リクエストのストア → stdio のプロセス全体 の順に見て、どちらも無ければ例外。
 */
export declare function getAuthContext(): AuthContext;
/**
 * API キーを検証して認証コンテキストを作って返す（グローバルは書き換えない）。
 * 呼び出し元が runWithAuthContext に渡す。
 */
export declare function resolveAuthContext(apiKey: string): Promise<AuthContext>;
/**
 * stdio サーバーの起動時に1回だけ呼ぶ。プロセス全体のコンテキストを決める。
 * HTTP からは呼ばないこと（resolveAuthContext + runWithAuthContext を使う）。
 */
export declare function initializeAuth(): Promise<void>;
/** テスト専用。プロセス全体のコンテキストを差し替える */
export declare function __setProcessAuthContextForTest(ctx: AuthContext | null): void;
export type { AuthContext, ActionType };
export { parseAllowedActions };
//# sourceMappingURL=config.d.ts.map