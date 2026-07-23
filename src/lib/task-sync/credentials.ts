import { decryptToken } from '@/lib/integrations/token-crypto'
import { getValidTokenDetailed, type TransientKind } from '@/lib/integrations/token-manager'
import type { ProviderCredentials } from '@/lib/task-sync/types'

/**
 * 接続行から、アダプタに渡す資格情報を解決する。
 *
 * OAuth と APIキー/PAT の**寿命管理の違い**をここ1箇所で吸収する:
 *   - oauth（refresh_token あり）: 期限があり refresh で更新される。既存 token-manager に委ねる
 *              （失効時の status='expired' 化・一時障害と失効の区別も既存の実装を再利用する）。
 *   - oauth（refresh_token 無し）: OAuth で取得したが**更新不能**（例: Notion のワークスペース
 *              トークンは無期限で refresh_token が存在しない。src/lib/notion/client.ts 参照）。
 *              寿命管理の実態は api_key と同じ＝運用者が失効させるまで有効なので、復号するだけ。
 *   - api_key: 期限が無く refresh も無い。運用者が失効させるまで有効なので、復号するだけ。
 *              **refresh を試みてはいけない**（refresh 経路に流すと 400 応答を「失効」と誤判定して
 *              正常な接続を expired 化してしまう）。
 *
 * なぜ「refresh_token の有無」で分岐するか（更新可能/不能の判定基準）:
 *   更新できる手段（refresh_token）があるのに refresh しないと、実際に失効していても気づけず
 *   古いトークンを使い続けてしまう。逆に、refresh する手段が無い接続を refresh 経路に流すと、
 *   （そもそも呼べる refresh エンドポイントが無いか、呼んでも意味を持たないため）外部の 400 応答を
 *   「失効」と誤判定して、正常な接続を expired 化してしまう。どちらも実データが持つ事実
 *   （refresh_token(_encrypted) があるか）だけで判定し、auth_kind の値だけでは判定しない
 *   （auth_kind='oauth' は「OAuthで取得した」という取得経路の記録に過ぎず、寿命管理の方式とは
 *   本質的に別の軸のため）。
 *
 * 格納先はどちらも `access_token_encrypted`。「APIに提示するシークレット」という意味論が同じで、
 * 差は auth_kind で表現できるため、列や表を分けない（分けると token-crypto の経路・RLS面・
 * import_config 検証トリガーの守備範囲が二重化するだけで利得がない）。
 */

export type CredentialResolution =
  | { status: 'ok'; credentials: ProviderCredentials }
  /** 資格情報が失効している（再接続が必要）。呼び出し側は毒にせず接続を skip する。 */
  | { status: 'auth_failed' }
  /**
   * DB瞬断・トークン復号RPC/vault 瞬断など一時的な障害。次サイクルで再試行する。
   * transientKind='refresh' は外部refresh起因(temporary_fail 相当)。field 不在=自分側インフラ由来
   * (呼び出し側は attempt を消費しない defer に回してよい対象)。
   */
  | { status: 'transient_error'; transientKind?: TransientKind }
  /** 設定不備（暗号化列が空・auth_kind 不整合）。再試行では直らない。 */
  | { status: 'misconfigured'; reason: string }

/** 解決に必要な接続行の最小形（呼び出し側が select する列）。 */
export interface ConnectionCredentialRow {
  id: string
  auth_kind: 'oauth' | 'api_key' | 'shared_secret'
  base_url: string | null
  access_token_encrypted: string | null
  /**
   * oauth 接続が refresh 可能かどうかの判定に使う（列名は token-manager.ts に合わせる）。
   * 平文列(refresh_token)は移行期のフォールバック用（token-manager と同じ扱い）。
   * どちらも無い/空なら「refresh 手段の無い OAuth」（例: Notion）として扱う。
   */
  refresh_token_encrypted?: string | null
  refresh_token?: string | null
}

/** OAuth の refresh 関数（provider ごとに違うため注入する）。 */
type RefreshFn = Parameters<typeof getValidTokenDetailed>[1]

export async function resolveCredentials(
  row: ConnectionCredentialRow,
  refreshFn?: RefreshFn,
): Promise<CredentialResolution> {
  if (row.auth_kind === 'oauth') {
    const hasRefreshToken = Boolean(row.refresh_token_encrypted) || Boolean(row.refresh_token)
    if (!hasRefreshToken) {
      // 更新不能な OAuth（refresh_token が存在しない。Notion のワークスペーストークン等）。
      // refresh を試みる手段が無いので、api_key と同じく復号するだけで良い。ここを
      // refreshFn 必須のまま扱うと、この種の接続が永久に misconfigured skip される
      // （実際に Notion 接続が一度も取り込まれない断線を起こした）。
      // decryptToken は一時障害(RPC/DB error)を throw、恒久破損(復号結果なし)を null で返す。
      // 一時障害を misconfigured(恒久)にすると次サイクルで直る接続を殺すため transient_error に写す。
      let token: string | null
      try {
        token = await decryptToken(row.access_token_encrypted)
      } catch {
        return { status: 'transient_error' }
      }
      if (!token) {
        return { status: 'misconfigured', reason: 'oauth access token is missing or undecryptable' }
      }
      return { status: 'ok', credentials: { kind: 'oauth', token, baseUrl: row.base_url } }
    }
    if (!refreshFn) {
      // refresh_token を持つ＝本来 refresh 可能な接続なのに refresh 手段が渡されていない
      // ＝アダプタ登録の配線ミス。再試行では直らない（更新不能なOAuthとは区別し、この場合だけ
      // refreshFn 必須のままにする＝失効の見逃しを防ぐ）。
      return { status: 'misconfigured', reason: 'oauth connection without refreshFn' }
    }
    const result = await getValidTokenDetailed(row.id, refreshFn)
    if (result.status !== 'ok') {
      // token-manager は失効(auth_failed)と一時障害(transient_error)を既に区別している。
      // その判断をここで作り直さず素通しする（失効判定の二重実装は事故のもと）。
      // transient のときは infra/refresh の由来(transientKind)もそのまま伝える(呼び出し側が defer 判定に使う)。
      if (result.status === 'auth_failed') return { status: 'auth_failed' }
      return result.transientKind
        ? { status: 'transient_error', transientKind: result.transientKind }
        : { status: 'transient_error' }
    }
    return {
      status: 'ok',
      credentials: { kind: 'oauth', token: result.token, baseUrl: row.base_url },
    }
  }

  if (row.auth_kind === 'api_key') {
    // decryptToken は一時障害を throw、恒久破損を null で返す(上の oauth 分岐と同じ扱い)。
    let token: string | null
    try {
      token = await decryptToken(row.access_token_encrypted)
    } catch {
      return { status: 'transient_error' }
    }
    if (!token) {
      // error無し・data無し＝暗号文が復号結果を持たない恒久破損。再試行では直らないので作り直しを促す。
      return { status: 'misconfigured', reason: 'api_key is missing or undecryptable' }
    }
    return { status: 'ok', credentials: { kind: 'api_key', token, baseUrl: row.base_url } }
  }

  // shared_secret（multica）はタスク同期アダプタの資格情報ではなく、送受信の相互鍵として
  // connectors/secrets.ts が別途扱う。ここに来るのは配線ミス。
  return { status: 'misconfigured', reason: `unsupported auth_kind: ${row.auth_kind}` }
}
