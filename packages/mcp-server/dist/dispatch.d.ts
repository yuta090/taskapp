/** dispatchTool が認証した鍵・組織・利用者と、実際に使われた spaceId（利用記録に使う） */
export interface DispatchAuthInfo {
    keyId: string;
    orgId: string;
    userId: string | null;
    spaceId: string | null;
}
/**
 * HTTP API 用ツールディスパッチ
 * API key で認証し、指定されたツールを実行して結果を返す
 * リクエストは直列化される（authContext がグローバルなため）
 *
 * onAuthenticated: 認証直後（ハンドラ実行前）に、この呼び出し自身の ctx/spaceId を報告する。
 * 呼び出し元（利用記録など）は、共有の config モジュールを読み直すのではなく、必ずこの値を
 * 使う。戻り値ではなくコールバックにするのは、ハンドラが失敗した場合でも ctx/spaceId を
 * 呼び出し元に渡すため
 */
export declare function dispatchTool(apiKey: string, toolName: string, params: Record<string, unknown>, onAuthenticated?: (info: DispatchAuthInfo) => void): Promise<unknown>;
export declare class ToolNotFoundError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=dispatch.d.ts.map