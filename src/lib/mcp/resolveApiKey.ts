/**
 * 接続の鍵を1本確かめる。
 *
 * /api/mcp は MCP の応答を返す前にここで一度確かめる。壊れた鍵のまま
 * 「つながりました」と返すと、つなぎ先（ChatGPT など）は接続できたと解釈して、
 * その後の操作が全部失敗し、利用者には理由が見えない。
 *
 * agentpm-core への入口をこの1ファイルに閉じておく。route から直接 dist を掘ると、
 * テストでそこをモックしたときにツール群まで巻き添えになる。
 */
export interface ResolvedKey {
  keyId: string
  userId: string | null
  orgId: string
  scope: 'space' | 'org' | 'user'
  allowedSpaceIds: string[] | null
  allowedActions: string[]
}

export async function resolveApiKey(apiKey: string): Promise<ResolvedKey> {
  // 動的 import。ビルド時に環境変数の確認が走るのを避ける（/api/tools と同じ理由）
  const { resolveAuthContext } = await import('agentpm-core/dist/config.js')
  return (await resolveAuthContext(apiKey)) as ResolvedKey
}
