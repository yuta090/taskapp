import { describe, it, expect } from 'vitest'
import { decideSharedSendBudget } from '@/lib/channels/metering/decideSharedSendBudget'

/**
 * decideSharedSendBudget — 共通LINE(共有bot)送信境界の二層quota判定
 * （設計正本 AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md §3「使用量メータリング（骨格）」・
 * entitlements.ts の NOTE(要決定・数値) fable指摘フォローアップ）。
 *
 * LINE無料枠(200通/月)は「LINEアカウント単位・共有bot全org相乗り」であり org単位ではない。
 * よって送信可否は必ず2層で判定する:
 *   1. org層（既存 decideAutoPush・org_channel_policy.state/on_exceed）
 *   2. account/グローバル層（共有アカウント横断の集計予算・本モジュールが追加する層）
 *
 * 合成規則（本モジュールの確定仕様）:
 *   - org層が deliver=false ならその時点で確定（グローバル層は評価しない・org層の reason を採用）。
 *     ＝ orgが自分のcapで既に止めているなら、グローバル層で緩めることは絶対にしない（fail-closed）。
 *   - org層が deliver=true の場合のみグローバル層を追加適用する:
 *       global.state='ok'   → そのまま send
 *       global.state='soft' → 隔日縮退（偶数日のみ送る。org層のdegradeと同じ日基準を再利用）
 *       global.state='hard' → 無条件 suppress（org側のon_exceedが'none'でも止める。
 *                              グローバル予算は「当社が守るべきLINEアカウントの実物理上限」であり、
 *                              個別orgの縮退方針(on_exceed)非設定を理由に超過させてはならないため）
 */
describe('decideSharedSendBudget', () => {
  const OK_ORG = { state: 'ok', onExceed: 'none' } as const

  it('org層がsendでglobalもok → send', () => {
    expect(
      decideSharedSendBudget({ org: OK_ORG, global: { state: 'ok' }, jstDayOfYear: 1 }),
    ).toEqual({ deliver: true })
  })

  describe('org層が既に抑止している場合はglobal層を評価せずそのまま確定する', () => {
    it('org層 hard/block suppress → globalがokでも抑止のまま', () => {
      const result = decideSharedSendBudget({
        org: { state: 'hard', onExceed: 'block' },
        global: { state: 'ok' },
        jstDayOfYear: 1,
      })
      expect(result).toEqual({ deliver: false, reason: 'quota_block_suppress' })
    })

    it('org層 soft/degrade の休止日(奇数日) → globalがokでも抑止のまま', () => {
      const result = decideSharedSendBudget({
        org: { state: 'soft', onExceed: 'degrade' },
        global: { state: 'ok' },
        jstDayOfYear: 1,
      })
      expect(result).toEqual({ deliver: false, reason: 'quota_soft_degrade_alt_day' })
    })
  })

  describe('org層がsendの場合のみglobal層を追加適用する', () => {
    it('global.state=ok → send', () => {
      expect(
        decideSharedSendBudget({ org: OK_ORG, global: { state: 'ok' }, jstDayOfYear: 3 }),
      ).toEqual({ deliver: true })
    })

    it('global.state=soft かつ 偶数日 → send（隔日の生存日）', () => {
      expect(
        decideSharedSendBudget({ org: OK_ORG, global: { state: 'soft' }, jstDayOfYear: 2 }),
      ).toEqual({ deliver: true })
    })

    it('global.state=soft かつ 奇数日 → 抑止（隔日の休止日）', () => {
      expect(
        decideSharedSendBudget({ org: OK_ORG, global: { state: 'soft' }, jstDayOfYear: 1 }),
      ).toEqual({ deliver: false, reason: 'global_budget_soft_degrade_alt_day' })
    })

    it('global.state=hard → 無条件suppress（偶数日でも抑止）', () => {
      expect(
        decideSharedSendBudget({ org: OK_ORG, global: { state: 'hard' }, jstDayOfYear: 2 }),
      ).toEqual({ deliver: false, reason: 'global_budget_hard_suppress' })
    })

    it('org層onExceed=noneで常にsendの既定orgでも、global.state=hardなら止める（グローバル予算は物理上限）', () => {
      const result = decideSharedSendBudget({
        org: { state: 'hard', onExceed: 'none' },
        global: { state: 'hard' },
        jstDayOfYear: 2,
      })
      expect(result).toEqual({ deliver: false, reason: 'global_budget_hard_suppress' })
    })
  })
})
