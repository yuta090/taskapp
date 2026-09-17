import { resolveAuthContext, runWithAuthContext } from './config.js';
import { allTools } from './tools/index.js';
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
export async function dispatchTool(apiKey, toolName, params, onAuthenticated) {
    const ctx = await resolveAuthContext(apiKey);
    return dispatchToolWithContext(ctx, toolName, params, onAuthenticated);
}
/**
 * 認証を済ませた状態で1本実行する。
 * 鍵の確かめ方が違う入口（OAuth の合鍵など）から使う。
 */
export async function dispatchToolWithContext(ctx, toolName, params, onAuthenticated) {
    const tool = allTools.find((t) => t.name === toolName);
    if (!tool) {
        throw new ToolNotFoundError(`Unknown tool: ${toolName}`);
    }
    return runWithAuthContext(ctx, async () => {
        const validatedParams = tool.inputSchema.parse(params);
        if (onAuthenticated) {
            const spaceId = typeof validatedParams?.spaceId === 'string'
                ? validatedParams.spaceId
                : null;
            onAuthenticated({ keyId: ctx.keyId, orgId: ctx.orgId, userId: ctx.userId, spaceId });
        }
        return await tool.handler(validatedParams);
    });
}
export class ToolNotFoundError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ToolNotFoundError';
    }
}
//# sourceMappingURL=dispatch.js.map