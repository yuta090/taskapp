import { assertAllowedHost, requireBaseUrl } from '@/lib/task-sync/hostPolicy'
import { providerError, type HostPolicy } from '@/lib/task-sync/types'

/**
 * kintone 共通クライアント — ホスト境界・認証ヘッダ・エラー分類を1箇所に集約する。
 *
 * providers/kintone.ts（アダプタ本体）と providers/kintone/schema.ts（フィールド定義取得。
 * 接続前のマッピングウィザードからも呼ばれ得るため ctx を組み立てられない）の両方がここを経由する。
 * 2箇所が別々に fetch すると、後述の「アプリを更新」未反映エラーの検知がどちらか片方でしか
 * 効かない事故が起きるため、fetch そのものをここに一本化した。
 */

/**
 * 接続先として許すドメイン。kintone はテナントごとのサブドメイン（https://<sub>.cybozu.com、
 * ドメイン許可制プランでは https://<sub>.kintone.com）で運用される。APIトークンがヘッダに乗る
 * 認証方式のため、送信先を間違えること自体が鍵の漏洩になる（backlog と同じ理由）。
 */
export const KINTONE_HOST_POLICY = {
  kind: 'vendor-domain',
  allowedSuffixes: ['.cybozu.com', '.kintone.com'],
} as const satisfies HostPolicy

const REQUEST_TIMEOUT_MS = 20_000

/**
 * X-Cybozu-API-Token ヘッダの1リクエストあたりの上限（公式ドキュメント通り。10個以上はエラー）。
 * ProviderCredentials.token はカンマ結合済みの不透明文字列として渡ってくる契約
 * （src/lib/task-sync/types.ts）。
 */
export const MAX_API_TOKENS_PER_REQUEST = 9

/**
 * トークン列（カンマ結合）を検証し、そのままヘッダ値として返す。上限超過は設定不備
 * （再試行しても直らない）として恒久エラーにする。
 */
export function buildTokenHeaderValue(tokens: string): string {
  const count = tokens.split(',').filter((t) => t.trim().length > 0).length
  if (count === 0) {
    throw providerError('kintone: APIトークンが設定されていない接続です', { permanent: true, status: 400 })
  }
  if (count > MAX_API_TOKENS_PER_REQUEST) {
    throw providerError(
      `kintone: APIトークンは1リクエストにつき最大${MAX_API_TOKENS_PER_REQUEST}個までです(設定=${count}個)`,
      { permanent: true, status: 400 },
    )
  }
  return tokens
}

/** baseUrl 配下の kintone REST API URL を組み立て、ホスト境界を実行時にも検証する。 */
export function apiUrl(baseUrl: string | null | undefined, path: string): string {
  const base = requireBaseUrl(KINTONE_HOST_POLICY, baseUrl, 'kintone')
  const origin = assertAllowedHost(KINTONE_HOST_POLICY, base, 'kintone')
  return new URL(path, origin.origin).toString()
}

/** 429 の `Retry-After`（秒）を ms に変換する。⚠ 下の注意書き参照。 */
function retryAfterMsFrom(headers: Headers | undefined): number | undefined {
  const raw = headers?.get('Retry-After')
  if (!raw) return undefined
  const sec = Number(raw)
  return Number.isFinite(sec) && sec > 0 ? sec * 1000 : undefined
}

/**
 * kintone のエラー応答本文（`{code, id, message}`。公式: Kintone REST API Overview の
 * Error Response）から、既知の「設定不備」パターンを **`code`（表示言語に依存しない安定した
 * 識別子）** で判定する。
 *
 * ⚠ 経緯（以前は message の部分一致で判定していた）: 最初の実装は英語の `message` 文字列の
 *   部分一致で判定していたが、kintone の応答メッセージは Administrator アカウントの表示言語
 *   設定に従う（Kintone REST API Overview / Get Records の Notes 節）ため、**この製品の主要顧客
 *   （日本の会計事務所＝kintone管理者の表示言語が日本語）では一切ヒットしなかった**。
 *   `code` は言語設定に依存しないため、`code` の完全一致を第一の判定に切り替えた。
 *
 * ⚠ 裏取りの範囲と限界（正直に書く。誤った断定をしない設計にしている理由）:
 *   下記4つのコード（GAIA_IA02/GAIA_AP15/GAIA_NO01/GAIA_UN03）は、cybozu.dev/kintone.dev の
 *   公開リファレンスにエラーコード一覧のページが見当たらず（本実装時に両サイトの sitemap を
 *   確認したが該当ページ無し、DuckDuckGo/Bing での検索でも一次情報に到達できなかった）、
 *   第三者のkintone関連ベンダー資料に基づく値である（公式ドキュメントでの再確認はできていない）。
 *   **この判定が外れていても壊れないように**、コード不一致・コード欠落のときは
 *   AUTH_LIKE_STATUSES（401/403/520。これらは典型的に認証・権限系の失敗でしか使われない）に
 *   限って「確認すべき点を可能性の高い順に列挙する」フォールバックメッセージに倒す
 *   （どの原因かを誤って断定しない。コード一致は「より親切な名指しメッセージを出せる場合の
 *   上乗せ」に過ぎず、一致しないと機能しない作りにはしていない）。
 */
type KintoneAuthFailureKind = 'not_deployed' | 'wrong_app' | 'insufficient_permission' | 'concurrent_conflict'

/** 既知のエラーコード → 分類。`permanent` はそのまま providerError に渡す値。 */
const KNOWN_ERROR_CODES: Readonly<Record<string, { kind: KintoneAuthFailureKind; permanent: boolean }>> = {
  // トークン文字列・アプリの組み合わせ自体は正しいが、アプリの設定画面で「アプリを更新」を
  // 押しておらず運用環境に反映されていない場合に返るとされるコード。
  GAIA_IA02: { kind: 'not_deployed', permanent: true },
  // APIトークンと指定したアプリ(app id)の組み合わせが不正(そのアプリで発行されたトークンでない)。
  GAIA_AP15: { kind: 'wrong_app', permanent: true },
  // APIトークンに、実行しようとしたAPIに必要な権限(レコード閲覧/追加/編集等)が付与されていない。
  GAIA_NO01: { kind: 'insufficient_permission', permanent: true },
  // レコードの同時編集競合(楽観ロック)。次サイクルで解消し得るため permanent にしない。
  GAIA_UN03: { kind: 'concurrent_conflict', permanent: false },
}

/**
 * `code` が既知パターンに一致しなかった/無かった場合にフォールバックとして扱うHTTPステータス。
 * これらは経験的に認証・権限系の失敗でしか使われない値のため、原因不明のままでも
 * 「アプリを更新/権限/トークンの組み合わせ」という3候補の案内自体は的外れになりにくい。
 * それ以外のステータス(400/404/429/500/503等)は今まで通りの汎用エラーメッセージのままにする
 * （的外れな認証案内を無関係な失敗に付けないため）。
 */
const AUTH_LIKE_STATUSES = new Set([401, 403, 520])

interface KintoneErrorBody {
  code?: string
  id?: string
  message?: string
}

/** !res.ok のとき、既知パターンなら名指しの恒久エラーに、そうでなければ汎用エラーに変換する。 */
async function throwForFailedResponse(res: Response, method: string, actionLabel: string): Promise<never> {
  // 応答本文には kintone 側のエラーメッセージ以外の情報は無いはずだが、念のためログには status
  // のみ出す（本文・URL・トークンは出さない。他アダプタと同じ流儀）。
  console.error('kintone API error:', method, res.status)

  let body: KintoneErrorBody | null = null
  try {
    body = (await res.json()) as KintoneErrorBody
  } catch {
    body = null // JSON以外の応答(HTML等)。既知パターン判定はスキップして汎用エラーへ。
  }

  const known = typeof body?.code === 'string' ? KNOWN_ERROR_CODES[body.code] : undefined

  if (known?.kind === 'not_deployed') {
    throw providerError(
      `kintone: APIトークンの設定がこのアプリの運用環境に反映されていません。kintone側のアプリ設定画面で「アプリを更新」ボタンを押してから再接続してください（${actionLabel}）。`,
      { permanent: known.permanent, status: res.status },
    )
  }
  if (known?.kind === 'wrong_app') {
    throw providerError(
      `kintone: このAPIトークンは指定されたアプリのものではありません。接続設定のアプリIDとAPIトークンの組み合わせを確認してください（${actionLabel}）。`,
      { permanent: known.permanent, status: res.status },
    )
  }
  if (known?.kind === 'insufficient_permission') {
    throw providerError(
      `kintone: このAPIトークンには「${actionLabel}」に必要なアクセス権がありません。kintone側のAPIトークン設定でアクセス権を確認してください。`,
      { permanent: known.permanent, status: res.status },
    )
  }
  if (known?.kind === 'concurrent_conflict') {
    throw providerError(
      `kintone: レコードが他の変更と競合しました(同時編集)。次回のポーリングで再試行されます（${actionLabel}）。`,
      { permanent: known.permanent, status: res.status },
    )
  }

  // フォールバック: codeが未知/欠落で、かつ典型的な認証・権限系のステータスのときは、誤って
  // 断定せず確認すべき点を可能性の高い順に列挙する(①アプリを更新 ②権限 ③トークンとアプリの組)。
  if (AUTH_LIKE_STATUSES.has(res.status)) {
    throw providerError(
      `kintone: APIトークンで接続できませんでした。kintone側で ①アプリの設定を運用環境に反映（「アプリを更新」）したか ②トークンに必要な権限（レコード閲覧、書き戻すなら編集）が付いているか ③トークンがこのアプリのものか を確認してください（${actionLabel}）。`,
      { permanent: true, status: res.status },
    )
  }

  throw providerError(`kintone API ${method} failed (${res.status}): ${actionLabel}`, {
    status: res.status,
    retryAfterMs: res.status === 429 || res.status === 503 ? retryAfterMsFrom(res.headers) : undefined,
  })
}

/**
 * kintone REST API への共通 fetch。トークン・応答本文はログに出さない
 * （応答本文には顧客のレコード内容が乗り得るため。既知パターン判定のためだけに一度 parse するが、
 * 判定結果しか外へ出さない）。`redirect: 'manual'` で転送を追わない（転送先へトークンを渡さないため）。
 *
 * @param actionLabel 失敗時のメッセージに使う、何をしようとしていたかの日本語ラベル
 *   （例: 'レコード一覧の取得(閲覧権限が必要)'）。
 */
export async function kintoneFetch(
  url: string,
  tokens: string,
  init: { method: string; body?: string },
  actionLabel: string,
): Promise<unknown> {
  const tokenHeader = buildTokenHeaderValue(tokens)
  let res: Response
  try {
    res = await fetch(url, {
      method: init.method,
      headers: {
        'X-Cybozu-API-Token': tokenHeader,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(
      `kintone API ${init.method} failed (network): ${err instanceof Error ? err.name : 'UnknownError'}`,
    )
  }

  if (res.status >= 300 && res.status < 400) {
    throw providerError(`kintone API ${init.method} unexpected redirect (${res.status})`, {
      status: 400,
      permanent: true,
    })
  }
  if (!res.ok) {
    return throwForFailedResponse(res, init.method, actionLabel)
  }
  return res.json()
}
