import { describe, it, expect } from 'vitest'
import {
  sumApprovedQuoteDeltas,
  applyQuoteDeltasToLimits,
  EMPTY_QUOTE_DELTAS,
  type BillingQuoteRow,
} from '@/lib/billing/quotes'
import { PLAN_LIMITS } from '@/lib/billing/entitlements'

function quote(partial: Partial<BillingQuoteRow>): BillingQuoteRow {
  return {
    id: 'q1',
    org_id: 'org-1',
    status: 'approved',
    amount_monthly_jpy: 5000,
    add_members: 0,
    add_line_groups: 0,
    add_external_chat_groups: 0,
    ...partial,
  } as BillingQuoteRow
}

describe('sumApprovedQuoteDeltas', () => {
  it('approved の行だけを合算する（提示中・却下・終了は数えない）', () => {
    const rows: BillingQuoteRow[] = [
      quote({ id: 'a', status: 'approved', add_members: 10, add_line_groups: 10 }),
      quote({ id: 'b', status: 'approved', add_members: 5 }),
      quote({ id: 'c', status: 'offered', add_members: 100 }),
      quote({ id: 'd', status: 'terminated', add_members: 100 }),
      quote({ id: 'e', status: 'rejected', add_line_groups: 100 }),
      quote({ id: 'f', status: 'expired', add_line_groups: 100 }),
    ]

    expect(sumApprovedQuoteDeltas(rows)).toEqual({
      addMembers: 15,
      addLineGroups: 10,
      addExternalChatGroups: 0,
    })
  })

  it('空配列はゼロ加算', () => {
    expect(sumApprovedQuoteDeltas([])).toEqual(EMPTY_QUOTE_DELTAS)
  })

  it('負の値は無視する（減枠は terminated で表現する約束を破らせない）', () => {
    const rows = [quote({ add_members: -50 as number, add_line_groups: 3 })]
    expect(sumApprovedQuoteDeltas(rows)).toEqual({
      addMembers: 0,
      addLineGroups: 3,
      addExternalChatGroups: 0,
    })
  })
})

describe('applyQuoteDeltasToLimits', () => {
  const deltas = { addMembers: 10, addLineGroups: 10, addExternalChatGroups: 5 }

  it('pro は加算される', () => {
    const limits = applyQuoteDeltasToLimits(PLAN_LIMITS.pro, deltas, 'pro')
    expect(limits.maxMembers).toBe(40) // 30 + 10
    expect(limits.maxLineGroups).toBe(60) // 50 + 10
    expect(limits.maxExternalChatGroups).toBe(55) // 50 + 5
  })

  it('free は加算しない（無料に落ちたら追加枠は失効する）', () => {
    expect(applyQuoteDeltasToLimits(PLAN_LIMITS.free, deltas, 'free')).toEqual(PLAN_LIMITS.free)
  })

  it('enterprise は元から無制限(null)なので加算しても無制限のまま', () => {
    const limits = applyQuoteDeltasToLimits(PLAN_LIMITS.enterprise, deltas, 'enterprise')
    expect(limits.maxMembers).toBeNull()
    expect(limits.maxLineGroups).toBeNull()
  })

  it('課金しない軸（プロジェクト・共通LINE送信・相手先ユーザー）は変えない', () => {
    const limits = applyQuoteDeltasToLimits(PLAN_LIMITS.pro, deltas, 'pro')
    expect(limits.maxProjects).toBe(PLAN_LIMITS.pro.maxProjects)
    expect(limits.monthlySharedPushQuota).toBe(PLAN_LIMITS.pro.monthlySharedPushQuota)
    expect(limits.maxClientUsers).toBe(PLAN_LIMITS.pro.maxClientUsers)
  })

  it('加算ゼロなら base と同一（挙動不変）', () => {
    expect(applyQuoteDeltasToLimits(PLAN_LIMITS.pro, EMPTY_QUOTE_DELTAS, 'pro')).toEqual(
      PLAN_LIMITS.pro,
    )
  })
})
