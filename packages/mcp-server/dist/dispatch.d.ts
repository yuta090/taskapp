/**
 * HTTP API 用ツールディスパッチ
 * API key で認証し、指定されたツールを実行して結果を返す
 * リクエストは直列化される（authContext がグローバルなため）
 */
export declare function dispatchTool(apiKey: string, toolName: string, params: Record<string, unknown>): Promise<unknown>;
export declare class ToolNotFoundError extends Error {
    constructor(message: string);
}
//# sourceMappingURL=dispatch.d.ts.map