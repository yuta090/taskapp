import { assertAllowedHost } from '@/lib/task-sync/hostPolicy'
import { providerError } from '@/lib/task-sync/types'
import type { HostPolicy } from '@/lib/task-sync/types'

/**
 * 会計/請求アダプタ共通のHTTP境界。
 *
 * 3つのアダプタ（freee / マネーフォワード / Misoca）は、送るヘッダが少し違うだけで
 * 「ホスト検証 → Bearer で叩く → 失敗を ProviderError に畳む」部分は完全に同じ。ここを
 * 各アダプタに書き写すと、再試行の分類（何が恒久失敗か・429をどう待つか）が3通りに劣化する。
 *
 * 失敗の分類は task-sync と同じ約束に揃える:
 *   - 400 / 404 / 422 は恒久失敗（設定不備・存在しない・内容が通らない。再試行で直らない）
 *   - それ以外の非2xxは一時失敗（呼び出し側がバックオフして再試行）
 *   - ネットワーク断・タイムアウトは status を付けない一時失敗
 */

const DEFAULT_TIMEOUT_MS = 20_000

export interface AccountingFetchInit {
  method: string
  /** JSON本体。undefined ならボディ無し（Content-Type も付けない）。 */
  body?: unknown
  /** 追加ヘッダ（APIバージョン指定など provider 固有のもの）。 */
  headers?: Record<string, string>
  /**
   * 二重発行を防ぐ冪等キー。provider が対応していれば効き、未対応でも未知ヘッダとして
   * 無視されるだけなので送って害はない。最終的な保証は呼び出し側の発行記録の一意制約で取る。
   */
  idempotencyKey?: string
  timeoutMs?: number
}

/**
 * 検証済みホストへJSONで問い合わせ、パース済みの本文を返す。
 *
 * @param label エラーメッセージに出す表示名（'freee' など）。利用者が読む文言になる。
 */
export async function accountingFetch(
  policy: HostPolicy,
  label: string,
  token: string,
  rawUrl: string,
  init: AccountingFetchInit,
): Promise<unknown> {
  const url = assertAllowedHost(policy, rawUrl, label)

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...(init.headers ?? {}),
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
  } catch (err) {
    throw providerError(`${label}: 接続に失敗しました (${(err as Error).message})`)
  }

  if (!response.ok) {
    const retryAfter = response.headers.get('retry-after')
    const detail = await response.text().catch(() => '')
    throw providerError(`${label}: APIエラー (${response.status}) ${detail.slice(0, 200)}`, {
      status: response.status,
      retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : undefined,
      permanent: response.status === 400 || response.status === 404 || response.status === 422,
    })
  }

  if (response.status === 204) return {}
  return response.json().catch(() => ({}))
}
