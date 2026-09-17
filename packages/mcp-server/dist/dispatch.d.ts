/** dispatchTool が認証した鍵・組織・利用者と、実際に使われた spaceId（利用記録に使う） */
export interface DispatchAuthInfo {
    keyId: string;
    orgId: string;
    userId: string | null;
    spaceId: string | null;
}
/**
 * HTTP API 用ツールディスパッチ
 * API key で認証し、指定されたツールを実行して結果を返す。
 *
 * ⚠ 以前はグローバルな認証コンテキストを書き換えていたため、全リクエストを直列化していた。
 * いまは認証コンテキストをこの呼び出しだけのストアに入れる（config.ts の runWithAuthContext）
 * ので、**並行して実行してよい**。直列化ロックを戻さないこと（1人の遅い呼び出しが全員を
 * 待たせる。リモートMCPでは致命的）。
 *
 * onAuthenticated: 認証直後（ハンドラ実行前）に、この呼び出し自身の ctx/spaceId を報告する。
 * 呼び出し元（利用記録など）は、共有のモジュールを読み直すのではなく必ずこの値を使う。
 * 戻り値ではなくコールバックにするのは、ハンドラが失敗した場合でも呼び出し元に渡すため。
 */
export declare function dispatchTool(apiKey: string, toolName: string, params: Record<string, unknown>, onAuthenticated?: (info: DispatchAuthInfo) => void): Promise<unknown>;
export declare class ToolNotFoundError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=dispatch.d.ts.map