import { describe, it, expect } from 'vitest'

import {
  buildLinesFromTasks,
  computeIdempotencyKey,
  MissingAmountError,
  subtotalOf,
} from '@/lib/accounting/issue'

const TASKS = [
  { id: 'b', title: 'トップページ改修', sellTotal: 120000 },
  { id: 'a', title: '問い合わせフォーム', sellTotal: 30000 },
]

const PARTS = {
  spaceId: 'space-1',
  docType: 'invoice' as const,
  partnerId: '1234',
  issueDate: '2026-07-31',
  taskIds: ['b', 'a'],
  subtotal: 150000,
}

describe('明細の組み立て', () => {
  it('タスク1件が明細1行になる（数量は常に1）', () => {
    const lines = buildLinesFromTasks(TASKS, 10)
    expect(lines).toEqual([
      { name: 'トップページ改修', quantity: 1, unitPrice: 120000, taxRate: 10 },
      { name: '問い合わせフォーム', quantity: 1, unitPrice: 30000, taxRate: 10 },
    ])
    expect(subtotalOf(lines)).toBe(150000)
  })

  it('金額未入力のタスクが混ざっていたら発行させない（0円で黙って通さない）', () => {
    expect(() =>
      buildLinesFromTasks([...TASKS, { id: 'c', title: '未見積の作業', sellTotal: null }], 10),
    ).toThrow(MissingAmountError)

    try {
      buildLinesFromTasks([{ id: 'c', title: '未見積の作業', sellTotal: null }], 10)
    } catch (err) {
      // どのタスクが原因かを画面に出せること
      expect((err as MissingAmountError).taskTitles).toEqual(['未見積の作業'])
    }
  })

  it('タスクが1件も無ければ発行させない', () => {
    expect(() => buildLinesFromTasks([], 10)).toThrow()
  })

  it('軽減税率・非課税も選べる', () => {
    expect(buildLinesFromTasks(TASKS, 8)[0].taxRate).toBe(8)
    expect(buildLinesFromTasks(TASKS, 0)[0].taxRate).toBe(0)
  })
})

describe('冪等キー（二重発行の防止）', () => {
  it('同じ内容なら同じ鍵になる（二度押しで2通目が作られない）', () => {
    expect(computeIdempotencyKey(PARTS)).toBe(computeIdempotencyKey(PARTS))
  })

  it('タスクの選択順が違っても同じ鍵になる（順序で二重発行を素通しさせない）', () => {
    expect(computeIdempotencyKey({ ...PARTS, taskIds: ['a', 'b'] })).toBe(
      computeIdempotencyKey({ ...PARTS, taskIds: ['b', 'a'] }),
    )
  })

  it('金額表現の違いでは変わらない（100 と 100.00 を別物にしない）', () => {
    expect(computeIdempotencyKey({ ...PARTS, subtotal: 150000 })).toBe(
      computeIdempotencyKey({ ...PARTS, subtotal: 150000.0 }),
    )
  })

  it('内容・日付・宛先・種別が変われば別の鍵になる（正当な再発行は妨げない）', () => {
    const base = computeIdempotencyKey(PARTS)
    expect(computeIdempotencyKey({ ...PARTS, issueDate: '2026-08-01' })).not.toBe(base)
    expect(computeIdempotencyKey({ ...PARTS, subtotal: 150001 })).not.toBe(base)
    expect(computeIdempotencyKey({ ...PARTS, partnerId: '9999' })).not.toBe(base)
    expect(computeIdempotencyKey({ ...PARTS, docType: 'quote' })).not.toBe(base)
    expect(computeIdempotencyKey({ ...PARTS, taskIds: ['a'] })).not.toBe(base)
    expect(computeIdempotencyKey({ ...PARTS, spaceId: 'space-2' })).not.toBe(base)
  })
})
