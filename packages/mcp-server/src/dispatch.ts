import { initializeAuthWithApiKey, getAuthContext } from './config.js'
import { allTools } from './tools/index.js'

/**
 * リクエスト直列化ロック
 * グローバルな authContext を変更するため、同時リクエストの競合を防ぐ
 */
let pending: Promise<unknown> = Promise.resolve()

/** dispatchTool が認証した鍵・組織・利用者と、実際に使われた spaceId（利用記録に使う） */
export interface DispatchAuthInfo {
  keyId: string
  orgId: string
  userId: string | null
  spaceId: string | null
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
export async function dispatchTool(
  apiKey: string,
  toolName: string,
  params: Record<string, unknown>,
  onAuthenticated?: (info: DispatchAuthInfo) => void,
): Promise<unknown> {
  // ツールを先に検索（ロック不要）
  const tool = allTools.find((t) => t.name === toolName)
  if (!tool) {
    throw new ToolNotFoundError(`Unknown tool: ${toolName}`)
  }

  // 認証 + 実行を直列化
  const result = pending.then(async () => {
    await initializeAuthWithApiKey(apiKey)
    const validatedParams = tool.inputSchema.parse(params)

    if (onAuthenticated) {
      const ctx = getAuthContext()
      const spaceId =
        typeof (validatedParams as Record<string, unknown>)?.spaceId === 'string'
          ? ((validatedParams as Record<string, unknown>).spaceId as string)
          : null
      onAuthenticated({ keyId: ctx.keyId, orgId: ctx.orgId, userId: ctx.userId, spaceId })
    }

    return await tool.handler(validatedParams as never)
  })

  // 次のリクエストは前のリクエスト完了後に開始（エラーでもチェーンを継続）
  pending = result.catch(() => {})

  return result
}

export class ToolNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolNotFoundError'
  }
}
