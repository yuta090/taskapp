import { initializeAuthWithApiKey } from './config.js';
import { allTools } from './tools/index.js';
/**
 * リクエスト直列化ロック
 * グローバルな authContext を変更するため、同時リクエストの競合を防ぐ
 */
let pending = Promise.resolve();
/**
 * HTTP API 用ツールディスパッチ
 * API key で認証し、指定されたツールを実行して結果を返す
 * リクエストは直列化される（authContext がグローバルなため）
 */
export async function dispatchTool(apiKey, toolName, params) {
    // ツールを先に検索（ロック不要）
    const tool = allTools.find((t) => t.name === toolName);
    if (!tool) {
        throw new ToolNotFoundError(`Unknown tool: ${toolName}`);
    }
    // 認証 + 実行を直列化
    const result = pending.then(async () => {
        await initializeAuthWithApiKey(apiKey);
        const validatedParams = tool.inputSchema.parse(params);
        return await tool.handler(validatedParams);
    });
    // 次のリクエストは前のリクエスト完了後に開始（エラーでもチェーンを継続）
    pending = result.catch(() => { });
    return result;
}
export class ToolNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolNotFoundError';
    }
}
//# sourceMappingURL=dispatch.js.map