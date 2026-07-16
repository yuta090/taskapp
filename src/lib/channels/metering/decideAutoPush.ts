import { jstNow } from '@/lib/datetime/jstNow'

/**
 * auto-push（channel-digest / approval-notify などの定期・催促push）の送信境界での縮退判定。
 * 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3(使用量メータリング骨格) / §7-10
 *
 * 適用範囲は auto-push のみ。webhookの対話的push（ユーザー操作への直接応答）・console手動送信は
 * この関数を通さない（設計正本「reply／ユーザー操作への直接応答は hard でも維持可」）。
 *
 * 真理値表（on_exceed × state）:
 *   none    : ok→send / soft→send            / hard→send    （既定org=常にno-op・退行ゲート）
 *   degrade : ok→send / soft→隔日(REDUCE)     / hard→SUPPRESS
 *   block   : ok→send / soft→send            / hard→SUPPRESS
 */
export type AutoPushDecision = { deliver: boolean; reason?: string }

export function decideAutoPush(args: {
  state: 'ok' | 'soft' | 'hard'
  onExceed: 'none' | 'degrade' | 'block'
  /** JST基準の通算日（1..366）。奇数/偶数で隔日縮退を判定する。呼出側が getJstDayOfYear() 等で算出する */
  jstDayOfYear: number
}): AutoPushDecision {
  const { state, onExceed, jstDayOfYear } = args

  // on_exceed='none' は常に send（全既定org＝実質no-op＝退行ゲート）
  if (onExceed === 'none') return { deliver: true }

  if (state === 'ok') return { deliver: true }

  if (state === 'hard') {
    return {
      deliver: false,
      reason: onExceed === 'block' ? 'quota_block_suppress' : 'quota_hard_suppress',
    }
  }

  // state === 'soft'
  if (onExceed === 'block') return { deliver: true } // blockはhardでのみ止める

  // onExceed === 'degrade': 隔日（偶数日のみ送る）
  if (jstDayOfYear % 2 === 0) return { deliver: true }
  return { deliver: false, reason: 'quota_soft_degrade_alt_day' }
}

/**
 * JST基準の通算日（1..366）。本番Vercelの既定UTCで生 new Date() の getter を使うと
 * 年またぎ・日またぎで1日ずれるため、jstNow()（JST成分を持つDate）から算出する
 * （メモリ [[jst-date-handling]]・toISOStringは使わない）。
 */
export function getJstDayOfYear(now: Date = new Date()): number {
  const jst = jstNow(now)
  const startOfYear = new Date(jst.getFullYear(), 0, 1)
  const diffMs = jst.getTime() - startOfYear.getTime()
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1
}
