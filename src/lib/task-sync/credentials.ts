import { decryptToken } from '@/lib/integrations/token-crypto'
import { getValidTokenDetailed } from '@/lib/integrations/token-manager'
import type { ProviderCredentials } from '@/lib/task-sync/types'

/**
 * 接続行から、アダプタに渡す資格情報を解決する。
 *
 * OAuth と APIキー/PAT の**寿命管理の違い**をここ1箇所で吸収する:
 *   - oauth:   期限があり refresh で更新される。既存 token-manager に委ねる（失効時の
 *              status='expired' 化・一時障害と失効の区別も既存の実装を再利用する）。
 *   - api_key: 期限が無く refresh も無い。運用者が失効させるまで有効なので、復号するだけ。
 *              **refresh を試みてはいけない**（refresh 経路に流すと 400 応答を「失効」と誤判定して
 *              正常な接続を expired 化してしまう）。
 *
 * 格納先はどちらも `access_token_encrypted`。「APIに提示するシークレット」という意味論が同じで、
 * 差は auth_kind で表現できるため、列や表を分けない（分けると token-crypto の経路・RLS面・
 * import_config 検証トリガーの守備範囲が二重化するだけで利得がない）。
 */

export type CredentialResolution =
  | { status: 'ok'; credentials: ProviderCredentials }
  /** 資格情報が失効している（再接続が必要）。呼び出し側は毒にせず接続を skip する。 */
  | { status: 'auth_failed' }
  /** DB瞬断など一時的な障害。次サイクルで再試行する。 */
  | { status: 'transient_error' }
  /** 設定不備（暗号化列が空・auth_kind 不整合）。再試行では直らない。 */
  | { status: 'misconfigured'; reason: string }

/** 解決に必要な接続行の最小形（呼び出し側が select する列）。 */
export interface ConnectionCredentialRow {
  id: string
  auth_kind: 'oauth' | 'api_key' | 'shared_secret'
  base_url: string | null
  access_token_encrypted: string | null
}

/** OAuth の refresh 関数（provider ごとに違うため注入する）。 */
type RefreshFn = Parameters<typeof getValidTokenDetailed>[1]

export async function resolveCredentials(
  row: ConnectionCredentialRow,
  refreshFn?: RefreshFn,
): Promise<CredentialResolution> {
  if (row.auth_kind === 'oauth') {
    if (!refreshFn) {
      // OAuth 接続なのに refresh 手段が無い＝アダプタ登録の配線ミス。再試行では直らない。
      return { status: 'misconfigured', reason: 'oauth connection without refreshFn' }
    }
    const result = await getValidTokenDetailed(row.id, refreshFn)
    if (result.status !== 'ok') {
      // token-manager は失効(auth_failed)と一時障害(transient_error)を既に区別している。
      // その判断をここで作り直さず素通しする（失効判定の二重実装は事故のもと）。
      return { status: result.status === 'auth_failed' ? 'auth_failed' : 'transient_error' }
    }
    return {
      status: 'ok',
      credentials: { kind: 'oauth', token: result.token, baseUrl: row.base_url },
    }
  }

  if (row.auth_kind === 'api_key') {
    const token = await decryptToken(row.access_token_encrypted)
    if (!token) {
      // 復号できない（鍵ローテ・空・不正blob）。再試行しても直らないので接続の作り直しを促す。
      return { status: 'misconfigured', reason: 'api_key is missing or undecryptable' }
    }
    return { status: 'ok', credentials: { kind: 'api_key', token, baseUrl: row.base_url } }
  }

  // shared_secret（multica）はタスク同期アダプタの資格情報ではなく、送受信の相互鍵として
  // connectors/secrets.ts が別途扱う。ここに来るのは配線ミス。
  return { status: 'misconfigured', reason: `unsupported auth_kind: ${row.auth_kind}` }
}
