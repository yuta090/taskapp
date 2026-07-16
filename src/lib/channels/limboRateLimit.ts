/**
 * limbo（共有botの未承認グループ）における紐付けコード投入のレート制限（設計正本 §7-8）。
 *
 * limboは会話を一切保存しない（§4）ため、永続テーブルを新設せず軽量なプロセス内メモリ
 * カウンタで数える（過剰実装を避ける・設計正本 §7「カウンタ実装方式(トリガー/cron)は後から
 * 変更可」）。サーバレス環境ではプロセスがリクエスト間で使い回されない場合カウンタがリセット
 * され得るが、攻撃緩和のベストエフォートとして許容する（webhookは常に200・limbo無保存の
 * 原則は崩さない）。
 *
 * 対象は「マッチした無効コード／コード不一致（rejected/not-foundに畳み込み済み）」の投入のみ。
 * 正規の成立（web_approval pending成立・code_only linked/already_linked）はカウントしない。
 */

const WINDOW_MS = 60 * 60 * 1000 // 1時間（設計正本 §7: 閾値/窓は後から変更可のノブ）
const MAX_INVALID_ATTEMPTS_PER_WINDOW = 10

interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

/**
 * 無効コード投入を1件記録し、このウィンドウで上限を超えたか(=以降を無応答化すべきか)を返す。
 * key は (accountId, externalGroupId) 単位 — グループ単位のレート制限（設計正本 §7-8）。
 */
export function registerInvalidClaimAttemptAndCheckLimit(
  accountId: string,
  externalGroupId: string,
): boolean {
  const key = `${accountId}:${externalGroupId}`
  const now = Date.now()
  const existing = buckets.get(key)

  if (!existing || now - existing.windowStart >= WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now })
    return false
  }

  existing.count += 1
  return existing.count > MAX_INVALID_ATTEMPTS_PER_WINDOW
}

/** テスト専用: モジュール状態（プロセス内メモリ）をリセットする */
export function __resetLimboRateLimitForTests(): void {
  buckets.clear()
}
