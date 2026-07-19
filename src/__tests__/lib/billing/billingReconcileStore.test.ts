import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * billingReconcileStore.listReconcilableBillingRows — keyset ページングとエラー throw の検証。
 * Supabase の1レスポンス上限(1000)を超える対象を取り切れること、DBエラーを空扱いにしないこと。
 */

// --- Supabase admin をモック（クエリビルダの chain を再現）---
type Row = {
  org_id: string
  plan_id: string | null
  status: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean | null
  stripe_subscription_id: string | null
}

const state = {
  pages: [] as Array<{ data: Row[] | null; error: { message: string } | null }>,
  gtCalls: [] as Array<string | number>,
  pageIndex: 0,
}

function makeChain() {
  const chain: Record<string, unknown> = {}
  Object.assign(chain, {
    select: vi.fn(() => chain),
    not: vi.fn(() => chain),
    neq: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    gt: vi.fn((_col: string, val: string | number) => {
      state.gtCalls.push(val)
      return chain
    }),
    // await されたら現在のページを返し、ページを進める
    then: (resolve: (v: unknown) => unknown) => {
      const page = state.pages[state.pageIndex] ?? { data: [], error: null }
      state.pageIndex += 1
      return resolve(page)
    },
  })
  return chain
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn(() => makeChain()) })),
}))

const { listReconcilableBillingRows } = await import('@/lib/billing/billingReconcileStore')

function row(i: number): Row {
  return {
    org_id: `org-${String(i).padStart(5, '0')}`,
    plan_id: 'pro',
    status: 'active',
    current_period_end: null,
    cancel_at_period_end: false,
    stripe_subscription_id: `sub_${i}`,
  }
}

beforeEach(() => {
  state.pages = []
  state.gtCalls = []
  state.pageIndex = 0
})

describe('listReconcilableBillingRows: keyset ページング', () => {
  it('1000件ちょうどのページの次も辿り、全件を取り切る（暗黙トランケートしない）', async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => row(i))
    const tail = [row(1000), row(1001)]
    state.pages = [
      { data: fullPage, error: null }, // 1ページ目=満杯 → 続行
      { data: tail, error: null }, // 2ページ目=1000未満 → 終了
    ]

    const rows = await listReconcilableBillingRows()

    expect(rows).toHaveLength(1002)
    // 2ページ目は1ページ目末尾の org_id を keyset に使う
    expect(state.gtCalls).toEqual(['org-00999'])
  })

  it('DBエラーは throw する（空配列にして「対象なし」と誤認しない）', async () => {
    state.pages = [{ data: null, error: { message: 'db down' } }]
    await expect(listReconcilableBillingRows()).rejects.toThrow(/db down/)
  })

  it('stripe_subscription_id が null の行は除外する', async () => {
    const r = row(1)
    const rNull = { ...row(2), stripe_subscription_id: null }
    state.pages = [{ data: [r, rNull], error: null }]
    const rows = await listReconcilableBillingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].stripeSubscriptionId).toBe('sub_1')
  })
})
