import { hashSecret } from '@/lib/mcp/oauth/secrets'

/**
 * /api/mcp に来た Bearer が誰のものかを1本に解決する。
 *
 * 受け取る合鍵は2種類:
 *   1. OAuth の合鍵 — ChatGPT などが同意フローで受け取ったもの。1時間で切れる
 *   2. APIキー — 画面で発行したもの。Claude Code・Cursor など貼り付けられるツール向け
 *
 * ⚠ OAuth の合鍵が通るのは、この受け口（/api/mcp）だけ。CLI 用の /api/tools は生のAPIキー
 * しか見ないため、この口で出した合鍵で CLI の全67ツールを触ることはできない。
 *
 * ⚠ agentpm-core への入口をこの1ファイルに閉じておく。route から直接 dist を掘ると、
 * テストでそこをモックしたときにツール群まで巻き添えになる。
 */
export interface ResolvedKey {
  keyId: string
  userId: string | null
  orgId: string
  scope: 'space' | 'org' | 'user'
  spaceId?: string | null
  allowedSpaceIds: string[] | null
  allowedActions: string[]
}

export async function resolveApiKey(bearer: string): Promise<ResolvedKey> {
  // 動的 import。ビルド時に環境変数の確認が走るのを避ける（/api/tools と同じ理由）
  const { resolveAuthContext, resolveAuthContextFromOAuthToken } = await import('agentpm-core/dist/config.js')

  // 先に OAuth の合鍵として引く。外部チャットからの接続はこちらが主
  try {
    return (await resolveAuthContextFromOAuthToken(hashSecret(bearer))) as ResolvedKey
  } catch {
    // 合鍵ではなかった。APIキーとして引き直す
  }

  return (await resolveAuthContext(bearer)) as ResolvedKey
}
