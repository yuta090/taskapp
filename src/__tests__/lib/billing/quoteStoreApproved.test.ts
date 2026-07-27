import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 承認済み追加枠の一覧（＝毎月請求すべき金額の正本）の取り出し方。
 *
 * ここが取りこぼすと **画面にも合計金額にもCSVにも出ないまま請求が漏れる**。
 * Supabase は1回のクエリで返せる行数に上限があるため、
 *   - 1ページ取って終わりにしない（全ページ取り切る）
 *   - それでも取り切れない異常時は黙って捨てず truncated=true で知らせる
 * を本テストで固定する。
 */

const mockAdminClient = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockAdminClient(),
}))

import {
  listApprovedQuotesWithOrg,
  APPROVED_QUOTES_PAGE_SIZE,
  APPROVED_QUOTES_MAX,
} from '@/lib/billing/quoteStore'

function makeRow(i: number) {
  return {
    id: `q-${i}`,
    org_id: i % 2 === 0 ? 'org-a' : 'org-b',
    status: 'approved',
    amount_monthly_jpy: 1000,
    add_members: 10,
    add_line_groups: 0,
    add_external_chat_groups: 0,
    approved_at: '2026-07-01T00:00:00.000Z',
    stripe_sync_status: 'pending',
  }
}

/**
 * billing_quotes は range() でページングし、organizations は in() で引く、という
 * 2種類のクエリを模す。requestedRanges に要求されたページ範囲を記録する。
 */
function makeAdmin(totalRows: number) {
  const requestedRanges: Array<[number, number]> = []
  const rows = Array.from({ length: totalRows }, (_, i) => makeRow(i))

  const from = vi.fn((table: string) => {
    if (table === 'organizations') {
      const builder: Record<string, unknown> = {}
      Object.assign(builder, {
        select: () => builder,
        in: () => Promise.resolve({ data: [{ id: 'org-a', name: 'A社' }], error: null }),
      })
      return builder
    }
    const builder: Record<string, unknown> = {}
    Object.assign(builder, {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: (from_: number, to: number) => {
        requestedRanges.push([from_, to])
        return Promise.resolve({ data: rows.slice(from_, to + 1), error: null })
      },
    })
    return builder
  })

  return { client: { from }, requestedRanges }
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('listApprovedQuotesWithOrg', () => {
  it('1ページに収まる件数はそのまま返し、truncated は false', async () => {
    mockAdminClient.mockReturnValue(makeAdmin(3).client)

    const { rows, truncated } = await listApprovedQuotesWithOrg()

    expect(rows).toHaveLength(3)
    expect(truncated).toBe(false)
    expect(rows[0].orgName).toBe('A社')
    // 組織名が引けなかったものは空欄にせず、それと分かる表示にする
    expect(rows[1].orgName).toBe('(不明な組織)')
  })

  it('1ページを超えても全ページ取り切る（501件目以降を落とさない）', async () => {
    const total = APPROVED_QUOTES_PAGE_SIZE + 7
    const admin = makeAdmin(total)
    mockAdminClient.mockReturnValue(admin.client)

    const { rows, truncated } = await listApprovedQuotesWithOrg()

    expect(rows).toHaveLength(total)
    expect(truncated).toBe(false)
    expect(admin.requestedRanges.length).toBeGreaterThanOrEqual(2)
  })

  it('取り切れない異常な件数のときは黙って捨てず truncated=true で知らせる', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAdminClient.mockReturnValue(makeAdmin(APPROVED_QUOTES_MAX + 1).client)

    const { rows, truncated } = await listApprovedQuotesWithOrg()

    expect(rows).toHaveLength(APPROVED_QUOTES_MAX)
    expect(truncated).toBe(true)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('クエリが失敗したら空で返す（画面を壊さない）', async () => {
    const from = vi.fn(() => {
      const builder: Record<string, unknown> = {}
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
      })
      return builder
    })
    mockAdminClient.mockReturnValue({ from })

    const { rows, truncated } = await listApprovedQuotesWithOrg()

    expect(rows).toEqual([])
    expect(truncated).toBe(false)
  })
})
