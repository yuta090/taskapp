import { describe, it, expect } from 'vitest'
import { buildApprovedQuotesCsv, monthlyTotalJpy, type ApprovedQuoteWithOrg } from '@/lib/billing/quotesCsv'

/**
 * 承認済み（＝請求すべき）追加枠のCSV。経理へそのまま渡す前提なので、
 * 壊れやすいところ（区切り文字・改行・引用符・Excelの文字化け・日付のタイムゾーン）を固定する。
 */

function row(overrides: Partial<ApprovedQuoteWithOrg> = {}): ApprovedQuoteWithOrg {
  return {
    id: 'q1',
    orgId: 'org-1',
    orgName: 'テスト事務所',
    amountMonthlyJpy: 5000,
    addMembers: 10,
    addLineGroups: 0,
    addExternalChatGroups: 0,
    approvedAt: '2026-07-26T01:23:45.000Z', // JST 2026-07-26 10:23
    stripeSyncStatus: 'pending',
    ...overrides,
  }
}

describe('buildApprovedQuotesCsv', () => {
  it('見出し行と1件ぶんの行を出す（金額は数値のまま＝経理が計算できる）', () => {
    const csv = buildApprovedQuotesCsv([row()])
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n')

    expect(lines[0]).toBe(
      '組織名,組織ID,月額(円),メンバー追加,相手先グループ追加,他チャット追加,承認日時(JST),請求反映',
    )
    expect(lines[1]).toBe('テスト事務所,org-1,5000,10,0,0,2026-07-26 10:23,未反映')
  })

  it('Excel で文字化けしないよう BOM を付ける', () => {
    expect(buildApprovedQuotesCsv([row()]).startsWith('﻿')).toBe(true)
  })

  it('カンマ・引用符・改行を含む組織名を壊さない', () => {
    const csv = buildApprovedQuotesCsv([
      row({ orgName: 'A社, B事業部\n"特命"' }),
    ])
    const body = csv.replace(/^﻿/, '').trim().split('\r\n').slice(1).join('\r\n')

    expect(body.startsWith('"A社, B事業部\n""特命"""')).toBe(true)
  })

  it('承認日時は日本時間で出す（UTCのままにしない）', () => {
    // UTC 2026-07-26T15:30Z は JST では翌日 00:30
    const csv = buildApprovedQuotesCsv([row({ approvedAt: '2026-07-26T15:30:00.000Z' })])
    expect(csv).toContain('2026-07-27 00:30')
  })

  it('反映済みは「反映済み」、Stripe未接続は「請求書」と表示する', () => {
    const csv = buildApprovedQuotesCsv([
      row({ id: 'a', stripeSyncStatus: 'applied' }),
      row({ id: 'b', stripeSyncStatus: 'manual' }),
    ])
    expect(csv).toContain('反映済み')
    expect(csv).toContain('請求書')
  })

  it('0件でも見出しだけのCSVを返す（空ファイルにしない）', () => {
    const csv = buildApprovedQuotesCsv([])
    expect(csv.replace(/^﻿/, '').trim().split('\r\n')).toHaveLength(1)
  })

  it('金額が未設定なら0として出す（空欄で経理を止めない）', () => {
    const csv = buildApprovedQuotesCsv([row({ amountMonthlyJpy: null })])
    expect(csv).toContain(',0,')
  })
})

describe('monthlyTotalJpy', () => {
  it('承認済みの月額を合計する', () => {
    expect(
      monthlyTotalJpy([row({ amountMonthlyJpy: 5000 }), row({ amountMonthlyJpy: 10000 })]),
    ).toBe(15000)
  })

  it('未設定は0として扱う', () => {
    expect(monthlyTotalJpy([row({ amountMonthlyJpy: null }), row({ amountMonthlyJpy: 800 })])).toBe(800)
  })

  it('0件は0', () => {
    expect(monthlyTotalJpy([])).toBe(0)
  })
})
