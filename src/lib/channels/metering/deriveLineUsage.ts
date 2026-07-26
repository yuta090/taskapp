/**
 * 共通LINE(共有bot)の当月送信量を「表示用」に整形する純粋関数。
 *
 * 送信可否の判定（実際に送るかどうか）は decideSharedSendBudget / decideAutoPush が真実源。
 * こちらは残数パネルに出すための整形だけを担う（副作用なし・DBに触れない）。
 *
 * level の閾値はサーバの集計関数 app_refresh_channel_metering_state と同じ:
 *   - used >= quota            → 'hard'（上限到達）
 *   - used >= ceil(quota*0.8)  → 'soft'（残りわずか）
 *   - それ以外                  → 'ok'
 * サーバ側 state は cron 実行までラグがあるため、表示はここで used/quota から都度計算し直す
 * （常に最新の見え方にする）。quota が null の org は Pro 等の無制限枠なので 'ok' 固定。
 */
export type LineUsageLevel = 'ok' | 'soft' | 'hard'

export interface LineUsageRaw {
  /** 当月の billable な送信成功数（app_org_channel_push_usage_current_month の戻り） */
  used: number
  /** 月間上限。null は無制限（Pro/Enterprise、または上限未設定） */
  quota: number | null
}

export interface LineUsageView {
  unlimited: boolean
  used: number
  quota: number | null
  /** 残り送信可能数。無制限なら null。負にはしない */
  remaining: number | null
  /** 消費割合 0..1。無制限なら null */
  ratio: number | null
  level: LineUsageLevel
}

export function deriveLineUsage(raw: LineUsageRaw): LineUsageView {
  const used = Number.isFinite(raw.used) && raw.used > 0 ? Math.floor(raw.used) : 0

  // quota が null / 0以下 は無制限扱い（0上限は運用上ありえず、割り算事故を避けるためここで吸収）
  if (raw.quota == null || raw.quota <= 0) {
    return { unlimited: true, used, quota: null, remaining: null, ratio: null, level: 'ok' }
  }

  const quota = Math.floor(raw.quota)
  const remaining = Math.max(0, quota - used)
  const ratio = Math.min(1, used / quota)

  let level: LineUsageLevel = 'ok'
  if (used >= quota) level = 'hard'
  else if (used >= Math.ceil(quota * 0.8)) level = 'soft'

  return { unlimited: false, used, quota, remaining, ratio, level }
}
