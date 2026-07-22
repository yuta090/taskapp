/**
 * 送信アダプタの共通インターフェース。
 * sinks/adapters の AdapterResult と同じ失敗分類思想を踏襲する:
 *   adapter は {ok, permanent?, status?} を返すだけ。恒久/一時の最終判断は
 *   呼び出し側（配達ループ）が status から分類してもよい（permanent 明示時はそれを優先）。
 *
 * 資格情報(credentials)は復号済みの平文で渡す。復号は channel_accounts を読む
 * service role 層（store）の責務で、アダプタ自体はHTTPの詳細だけを持つ（テスト容易性）。
 */

export interface OutboundContext {
  /** channel_accounts.credentials_encrypted を復号したJSON */
  credentials: Record<string, string>
  /** 送信先ID（チャネルごとに意味が異なる。registry.targetHint 参照） */
  to: string
  /** 本文（プレーンテキスト。装飾は各アダプタが最小限に整形） */
  text: string
  /** 冪等キー（再試行時の二重配信防止。対応チャネルのみ利用） */
  idempotencyKey?: string
  /**
   * チャネル固有のリッチ表現（LINEのFlex等）。解釈できるアダプタのみが使う。
   * 床はあくまで text — rich を解釈しないアダプタは無視して text を送る。
   */
  rich?: unknown
}

export interface OutboundResult {
  ok: boolean
  /** true=恒久失敗（リトライ無意味）。undefined なら status から分類 */
  permanent?: boolean
  /** HTTPステータス（取得できた場合） */
  status?: number
  /** 失敗理由（ログ/デバッグ用。機微値は含めない） */
  error?: string
  /** チャネル側メッセージID（dedupe/証跡用。取得できた場合） */
  externalMessageId?: string
}

export type OutboundAdapter = (ctx: OutboundContext) => Promise<OutboundResult>

/** 資格情報の必須キー欠落を恒久失敗として返す共通ヘルパー */
export function missingCredential(key: string): OutboundResult {
  return { ok: false, permanent: true, error: `missing credential: ${key}` }
}

/**
 * HTTPステータスから恒久/一時を分類する共通ルール（sinks と一致させる）。
 *   401/403/404/400/422 → permanent、429/5xx → temporary。
 */
export function classifyStatus(status: number): { permanent: boolean } {
  if (status === 429 || status >= 500) return { permanent: false }
  if (status === 401 || status === 403 || status === 404 || status === 400 || status === 422) {
    return { permanent: true }
  }
  // その他4xxは保守的に恒久扱い（設定不備の可能性が高い）
  if (status >= 400) return { permanent: true }
  return { permanent: false }
}
