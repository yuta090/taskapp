import { describe, it, expect } from 'vitest'

import { ACCOUNTING_ADAPTERS } from '@/lib/accounting/adapters'
import { IMPLEMENTED_ACCOUNTING_PROVIDERS } from '@/lib/accounting/implemented'
import {
  buildDocumentPayload as buildFreeePayload,
  mapFreeeStatus,
} from '@/lib/accounting/providers/freee'
import {
  buildDocumentPayload as buildMfPayload,
  mapMoneyForwardStatus,
} from '@/lib/accounting/providers/moneyForward'
import {
  buildDocumentPayload as buildMisocaPayload,
  mapMisocaStatus,
} from '@/lib/accounting/providers/misoca'
import type { DocumentInput } from '@/lib/accounting/types'

const INPUT: DocumentInput = {
  partnerId: '1234',
  title: 'サイト制作 2026年7月分',
  issueDate: '2026-07-31',
  dueDate: '2026-08-31',
  lines: [
    { name: 'トップページ改修', quantity: 1, unitPrice: 120000, taxRate: 10 },
    { name: '軽減税率の品目', quantity: 2, unitPrice: 500, taxRate: 8, description: '備考' },
  ],
  memo: 'いつもありがとうございます',
}

describe('会計アダプタ — 実装一覧の整合', () => {
  it('adapters.ts と implemented.ts が一致する（片方だけに足すと落ちる）', () => {
    expect(Object.keys(ACCOUNTING_ADAPTERS).sort()).toEqual([...IMPLEMENTED_ACCOUNTING_PROVIDERS].sort())
  })

  it('各アダプタの id とキーが一致し、見積書・請求書の両方を作れる', () => {
    for (const [key, adapter] of Object.entries(ACCOUNTING_ADAPTERS)) {
      expect(adapter.id).toBe(key)
      expect(adapter.supports).toContain('quote')
      expect(adapter.supports).toContain('invoice')
    }
  })

  it('接続先は全て固定ホスト（利用者がURLを入力する余地を作らない）', () => {
    for (const adapter of Object.values(ACCOUNTING_ADAPTERS)) {
      expect(adapter.hostPolicy.kind).toBe('fixed')
    }
  })
})

describe('freee — 書類の組み立て', () => {
  it('請求書は発行日と支払期日を送る', () => {
    const payload = buildFreeePayload(99, 'invoice', INPUT)
    expect(payload.company_id).toBe(99)
    expect(payload.partner_id).toBe(1234)
    expect(payload.issue_date).toBe('2026-07-31')
    expect(payload.due_date).toBe('2026-08-31')
    expect(payload.quotation_date).toBeUndefined()
  })

  it('見積書は「支払期日」ではなく「有効期限」に入れる（取り違えると期日が誤って伝わる）', () => {
    const payload = buildFreeePayload(99, 'quote', INPUT)
    expect(payload.quotation_date).toBe('2026-07-31')
    expect(payload.expiration_date).toBe('2026-08-31')
    expect(payload.due_date).toBeUndefined()
    expect(payload.issue_date).toBeUndefined()
  })

  it('期限が無ければ期限のキー自体を送らない', () => {
    const payload = buildFreeePayload(99, 'invoice', { ...INPUT, dueDate: null })
    expect('due_date' in payload).toBe(false)
  })

  it('明細は税率をそのまま数値で持つ', () => {
    const payload = buildFreeePayload(99, 'invoice', INPUT) as { lines: Array<Record<string, unknown>> }
    expect(payload.lines).toHaveLength(2)
    expect(payload.lines[0]).toMatchObject({ description: 'トップページ改修', quantity: 1, unit_price: 120000, tax_rate: 10 })
    expect(payload.lines[1]).toMatchObject({ tax_rate: 8 })
  })

  it('知らないステータスは unknown に落とす（入金済みと誤認しない）', () => {
    expect(mapFreeeStatus('invoice', 'paid')).toBe('paid')
    expect(mapFreeeStatus('invoice', 'issue')).toBe('issued')
    expect(mapFreeeStatus('invoice', 'draft')).toBe('draft')
    expect(mapFreeeStatus('invoice', 'なにか新しい状態')).toBe('unknown')
    expect(mapFreeeStatus('invoice', null)).toBe('unknown')
    // 見積書に paid は無い。請求書用の語彙を見積書へ持ち込まない。
    expect(mapFreeeStatus('quote', 'paid')).toBe('unknown')
    expect(mapFreeeStatus('quote', 'agreed')).toBe('accepted')
  })
})

describe('マネーフォワード クラウド請求書 — 書類の組み立て', () => {
  it('請求書は billing_date / due_date を送る', () => {
    const payload = buildMfPayload('invoice', INPUT)
    expect(payload.billing_date).toBe('2026-07-31')
    expect(payload.due_date).toBe('2026-08-31')
  })

  it('見積書は quote_date / expired_date（有効期限）を送る', () => {
    const payload = buildMfPayload('quote', INPUT)
    expect(payload.quote_date).toBe('2026-07-31')
    expect(payload.expired_date).toBe('2026-08-31')
    expect(payload.due_date).toBeUndefined()
  })

  it('税率は税区分コードに写す（数値のままでは通らない）', () => {
    const payload = buildMfPayload('invoice', INPUT) as { items: Array<Record<string, unknown>> }
    expect(payload.items[0].excise).toBe('ten_percent')
    expect(payload.items[1].excise).toBe('eight_percent_as_reduced_tax_rate')
  })

  it('入金状態は掲載状態より優先して見る（入金済みを取りこぼさない）', () => {
    expect(mapMoneyForwardStatus('invoice', { postingStatus: 'posted', paymentStatus: 'paid' })).toBe('paid')
    expect(mapMoneyForwardStatus('invoice', { postingStatus: 'posted', paymentStatus: 'unpaid' })).toBe('issued')
    expect(mapMoneyForwardStatus('invoice', { postingStatus: 'draft' })).toBe('draft')
    expect(mapMoneyForwardStatus('invoice', {})).toBe('unknown')
    // 見積書は入金の概念が無いので paid に落ちない。
    expect(mapMoneyForwardStatus('quote', { postingStatus: 'posted', paymentStatus: 'paid' })).toBe('issued')
  })
})

describe('Misoca — 書類の組み立て', () => {
  it('請求書は支払期日、見積書は有効期限に入れる', () => {
    expect(buildMisocaPayload('invoice', INPUT).payment_due_on).toBe('2026-08-31')
    expect(buildMisocaPayload('invoice', INPUT).expired_date).toBeUndefined()
    expect(buildMisocaPayload('quote', INPUT).expired_date).toBe('2026-08-31')
    expect(buildMisocaPayload('quote', INPUT).payment_due_on).toBeUndefined()
  })

  it('宛先は担当者ではなく取引先(contact_group)に送る', () => {
    expect(buildMisocaPayload('invoice', INPUT).contact_group_id).toBe('1234')
  })

  it('税率は税区分に写す', () => {
    const payload = buildMisocaPayload('invoice', INPUT) as { items: Array<Record<string, unknown>> }
    expect(payload.items[0].tax_type).toBe('standard')
    expect(payload.items[1].tax_type).toBe('reduced')
  })

  it('入金状態を優先して見る', () => {
    expect(mapMisocaStatus('invoice', { status: 'issued', paymentStatus: 'paid' })).toBe('paid')
    expect(mapMisocaStatus('invoice', { status: 'issued' })).toBe('issued')
    expect(mapMisocaStatus('invoice', { status: '謎' })).toBe('unknown')
  })
})
