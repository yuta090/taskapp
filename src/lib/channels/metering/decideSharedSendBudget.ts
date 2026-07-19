import { decideAutoPush, type AutoPushDecision } from '@/lib/channels/metering/decideAutoPush'

/**
 * 共通LINE(共有bot)送信境界の二層quota判定（純粋ロジック層）。
 * 設計正本: docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3
 *   「使用量メータリング（骨格）」の既知フォローアップ #2（account軸の相乗り監視・執行は未実装）
 *   ＋ src/lib/billing/entitlements.ts の NOTE(要決定・数値)（fable指摘: LINE無料枠は
 *   アカウント単位・共有bot全org相乗りのため、org別capだけでは持ち出しが非有界）。
 *
 * LINE無料枠(200通/月)は「LINEアカウント単位（＝共有bot全org相乗り）」であり org単位ではない。
 * よって送信可否は必ず2層で判定する:
 *   1. org層（既存 decideAutoPush・org_channel_policy.state/on_exceed。org別capの縮退方針）
 *   2. グローバル層（共有アカウント横断の集計予算。本モジュールが追加する層。集計方法は
 *      cron側の実装マター＝本関数はstate('ok'|'soft'|'hard')を受け取るだけの純粋関数）
 *
 * 合成規則（優先順位は「より制限が強い方が勝つ」＝fail-closed）:
 *   - org層が deliver=false ならその時点で確定する。org層の reason をそのまま採用し、
 *     グローバル層は評価しない（＝グローバル層で緩めることは絶対にしない）。
 *   - org層が deliver=true の場合のみグローバル層を追加適用する:
 *       global.state='ok'   → そのまま send
 *       global.state='soft' → 隔日縮退（偶数日のみ送る。org層のdegradeと同じ日基準を再利用）
 *       global.state='hard' → 無条件 suppress。org側の on_exceed が 'none'（常送信の既定org）
 *                              でも止める — グローバル予算は「当社が守るべきLINEアカウントの
 *                              実物理上限」であり、個別orgが縮退方針を未設定であることを理由に
 *                              アカウント全体の超過を許してはならない。
 *
 * 注: グローバル層の state を実際に集計・更新するcron/DDLはこの関数のスコープ外
 *   （既存メータリング(app_refresh_channel_metering_state)を壊さないよう、実装は別PRで
 *   段階的に追加する。本関数はその状態を受け取って合成する判定ロジックのみを提供する）。
 */
export type GlobalSharedBudgetState = 'ok' | 'soft' | 'hard'

export interface DecideSharedSendBudgetArgs {
  org: {
    state: 'ok' | 'soft' | 'hard'
    onExceed: 'none' | 'degrade' | 'block'
  }
  global: {
    state: GlobalSharedBudgetState
  }
  /** JST基準の通算日（1..366）。org層・global層の隔日縮退は同じ日基準を共有する */
  jstDayOfYear: number
}

export function decideSharedSendBudget(args: DecideSharedSendBudgetArgs): AutoPushDecision {
  const { org, global, jstDayOfYear } = args

  const orgDecision = decideAutoPush({
    state: org.state,
    onExceed: org.onExceed,
    jstDayOfYear,
  })
  if (!orgDecision.deliver) return orgDecision

  if (global.state === 'ok') return { deliver: true }

  if (global.state === 'hard') {
    return { deliver: false, reason: 'global_budget_hard_suppress' }
  }

  // global.state === 'soft': 隔日縮退（偶数日のみ送る。org層degradeと同じ日基準）
  if (jstDayOfYear % 2 === 0) return { deliver: true }
  return { deliver: false, reason: 'global_budget_soft_degrade_alt_day' }
}
