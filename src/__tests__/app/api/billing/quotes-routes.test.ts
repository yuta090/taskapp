import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * 枠追加の見積もり API（顧客側 / 当社側）。
 *
 * 守るべき不変条件:
 *   - 承認＝支払いの約束 → **owner 以外は触れない**（member でも403）
 *   - 承認者はセッションから解決（クライアント申告を受けない）
 *   - 表示中の金額のエコーバックが行と違えば承認しない（提示差し替えの事故防止）
 *   - 二重押しの2回目・期限切れは成立させない
 *   - 他org の見積もりを自org の ID で操作できない
 */

const mockRequireInternalMember = vi.fn()
vi.mock('@/lib/channels/authz', () => ({
  requireInternalMember: (...args: unknown[]) => mockRequireInternalMember(...args),
}))

const mockVerifySuperadmin = vi.fn()
vi.mock('@/lib/admin/verify-superadmin', () => ({
  verifySuperadmin: () => mockVerifySuperadmin(),
}))

const store = {
  listOrgQuotes: vi.fn(),
  createQuoteRequest: vi.fn(),
  approveQuote: vi.fn(),
  rejectQuote: vi.fn(),
  getQuoteOrgId: vi.fn(),
  listOpenQuotes: vi.fn(),
  listPendingSyncQuotes: vi.fn(),
  offerQuote: vi.fn(),
  cancelQuote: vi.fn(),
  terminateQuote: vi.fn(),
  markStripeSyncApplied: vi.fn(),
  listApprovedQuotesWithOrg: vi.fn(),
}
vi.mock('@/lib/billing/quoteStore', async () => {
  const actual = await vi.importActual<typeof import('@/lib/billing/quoteStore')>(
    '@/lib/billing/quoteStore',
  )
  return {
    QuoteConflictError: actual.QuoteConflictError,
    listOrgQuotes: (...a: unknown[]) => store.listOrgQuotes(...a),
    createQuoteRequest: (...a: unknown[]) => store.createQuoteRequest(...a),
    approveQuote: (...a: unknown[]) => store.approveQuote(...a),
    rejectQuote: (...a: unknown[]) => store.rejectQuote(...a),
    getQuoteOrgId: (...a: unknown[]) => store.getQuoteOrgId(...a),
    listOpenQuotes: (...a: unknown[]) => store.listOpenQuotes(...a),
    listPendingSyncQuotes: (...a: unknown[]) => store.listPendingSyncQuotes(...a),
    offerQuote: (...a: unknown[]) => store.offerQuote(...a),
    cancelQuote: (...a: unknown[]) => store.cancelQuote(...a),
    terminateQuote: (...a: unknown[]) => store.terminateQuote(...a),
    markStripeSyncApplied: (...a: unknown[]) => store.markStripeSyncApplied(...a),
    listApprovedQuotesWithOrg: (...a: unknown[]) => store.listApprovedQuotesWithOrg(...a),
  }
})

import { GET as listQuotes, POST as requestQuote } from '@/app/api/billing/quotes/route'
import { POST as respondQuote } from '@/app/api/billing/quotes/[quoteId]/route'
import {
  GET as adminList,
  POST as adminOffer,
  PATCH as adminPatch,
} from '@/app/api/admin/quotes/route'
import { GET as exportCsv } from '@/app/api/admin/quotes/export/route'
import { QuoteConflictError } from '@/lib/billing/quoteStore'

const ORG_ID = '11111111-2222-3333-4444-555555555555'
const OTHER_ORG_ID = '99999999-2222-3333-4444-555555555555'
const QUOTE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

function post(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function patch(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
const quoteParams = { params: Promise.resolve({ quoteId: QUOTE_ID }) }

function asOwner() {
  mockRequireInternalMember.mockResolvedValue({ ok: true, userId: 'user-owner', role: 'owner' })
}
function asMember() {
  mockRequireInternalMember.mockResolvedValue({ ok: true, userId: 'user-member', role: 'member' })
}

beforeEach(() => {
  vi.clearAllMocks()
  store.getQuoteOrgId.mockResolvedValue(ORG_ID)
})

describe('GET /api/billing/quotes', () => {
  it('owner は自組織の見積もりを一覧できる', async () => {
    asOwner()
    store.listOrgQuotes.mockResolvedValue([{ id: QUOTE_ID, status: 'offered' }])

    const res = await listQuotes(new NextRequest(`http://localhost/api/billing/quotes?orgId=${ORG_ID}`))

    expect(res.status).toBe(200)
    expect((await res.json()).quotes).toHaveLength(1)
  })

  it('member は403（金額は owner にしか見せない）', async () => {
    asMember()
    const res = await listQuotes(new NextRequest(`http://localhost/api/billing/quotes?orgId=${ORG_ID}`))
    expect(res.status).toBe(403)
  })

  it('orgId が UUID でなければ400', async () => {
    const res = await listQuotes(new NextRequest('http://localhost/api/billing/quotes?orgId=abc'))
    expect(res.status).toBe(400)
    expect(mockRequireInternalMember).not.toHaveBeenCalled()
  })
})

describe('POST /api/billing/quotes（依頼）', () => {
  const url = 'http://localhost/api/billing/quotes'

  it('owner は枠追加を依頼できる（この時点では枠は増えない）', async () => {
    asOwner()
    store.createQuoteRequest.mockResolvedValue({ id: QUOTE_ID, status: 'requested' })

    const res = await requestQuote(post(url, { orgId: ORG_ID, note: 'メンバー+10' }))

    expect(res.status).toBe(200)
    expect(store.createQuoteRequest).toHaveBeenCalledWith({
      orgId: ORG_ID,
      userId: 'user-owner',
      note: 'メンバー+10',
    })
  })

  it('内容が空なら400', async () => {
    asOwner()
    const res = await requestQuote(post(url, { orgId: ORG_ID, note: '   ' }))
    expect(res.status).toBe(400)
    expect(store.createQuoteRequest).not.toHaveBeenCalled()
  })

  it('進行中の見積もりが既にあれば409', async () => {
    asOwner()
    store.createQuoteRequest.mockRejectedValue(new QuoteConflictError())

    const res = await requestQuote(post(url, { orgId: ORG_ID, note: '追加希望' }))

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('quote_already_open')
  })

  it('member は依頼できない（403）', async () => {
    asMember()
    const res = await requestQuote(post(url, { orgId: ORG_ID, note: '追加希望' }))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/billing/quotes/[quoteId]（承認・見送り）', () => {
  const url = `http://localhost/api/billing/quotes/${QUOTE_ID}`

  it('owner が金額をエコーバックして承認すると成立する', async () => {
    asOwner()
    store.approveQuote.mockResolvedValue({ ok: true })

    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve', amount: 5000 }), quoteParams)

    expect(res.status).toBe(200)
    // 承認者はセッション由来（クライアント申告ではない）
    expect(store.approveQuote).toHaveBeenCalledWith(QUOTE_ID, 'user-owner', 5000)
  })

  it('member は承認できない（403・支払いの約束のため）', async () => {
    asMember()
    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve', amount: 5000 }), quoteParams)
    expect(res.status).toBe(403)
    expect(store.approveQuote).not.toHaveBeenCalled()
  })

  it('金額が付いていない承認は400（エコーバック必須）', async () => {
    asOwner()
    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve' }), quoteParams)
    expect(res.status).toBe(400)
    expect(store.approveQuote).not.toHaveBeenCalled()
  })

  it('表示金額と行が違えば409（提示差し替え後の古い画面から承認させない）', async () => {
    asOwner()
    store.approveQuote.mockResolvedValue({ ok: false, reason: 'amount_mismatch' })

    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve', amount: 1 }), quoteParams)

    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('amount_mismatch')
  })

  it('二重押しの2回目は409', async () => {
    asOwner()
    store.approveQuote.mockResolvedValue({ ok: false, reason: 'not_offered' })

    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve', amount: 5000 }), quoteParams)

    expect(res.status).toBe(409)
  })

  it('期限切れは410', async () => {
    asOwner()
    store.approveQuote.mockResolvedValue({ ok: false, reason: 'expired' })

    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve', amount: 5000 }), quoteParams)

    expect(res.status).toBe(410)
  })

  it('他org の見積もりは自org の ID を付けても404', async () => {
    asOwner()
    store.getQuoteOrgId.mockResolvedValue(OTHER_ORG_ID)

    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'approve', amount: 5000 }), quoteParams)

    expect(res.status).toBe(404)
    expect(store.approveQuote).not.toHaveBeenCalled()
  })

  it('見送り(reject)は金額不要で成立する', async () => {
    asOwner()
    store.rejectQuote.mockResolvedValue(true)

    const res = await respondQuote(post(url, { orgId: ORG_ID, action: 'reject' }), quoteParams)

    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('rejected')
  })
})

describe('/api/admin/quotes（当社側）', () => {
  const url = 'http://localhost/api/admin/quotes'

  it('superadmin でなければ全操作403', async () => {
    mockVerifySuperadmin.mockResolvedValue(null)

    expect((await adminList()).status).toBe(403)
    expect((await adminOffer(post(url, { quoteId: QUOTE_ID }))).status).toBe(403)
    expect((await adminPatch(patch(url, { quoteId: QUOTE_ID, action: 'cancel' }))).status).toBe(403)
    expect(store.offerQuote).not.toHaveBeenCalled()
  })

  it('金額と加算を指定して提示できる（有効期限が付く）', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')
    store.offerQuote.mockResolvedValue(true)

    const res = await adminOffer(
      post(url, { quoteId: QUOTE_ID, amountMonthlyJpy: 5000, addMembers: 10 }),
    )

    expect(res.status).toBe(200)
    expect((await res.json()).expiresAt).toBeTruthy()
    expect(store.offerQuote).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: QUOTE_ID, amountMonthlyJpy: 5000, addMembers: 10, adminUserId: 'admin-1' }),
    )
  })

  it('増やす枠が全て0の提示は400（意味のない提示を作らせない）', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')

    const res = await adminOffer(post(url, { quoteId: QUOTE_ID, amountMonthlyJpy: 5000 }))

    expect(res.status).toBe(400)
    expect(store.offerQuote).not.toHaveBeenCalled()
  })

  it('負の加算は400（減枠は terminate で表現する）', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')

    const res = await adminOffer(
      post(url, { quoteId: QUOTE_ID, amountMonthlyJpy: 5000, addMembers: -5 }),
    )

    expect(res.status).toBe(400)
  })

  it('依頼中でない見積もりへの提示は409', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')
    store.offerQuote.mockResolvedValue(false)

    const res = await adminOffer(
      post(url, { quoteId: QUOTE_ID, amountMonthlyJpy: 5000, addLineGroups: 10 }),
    )

    expect(res.status).toBe(409)
  })

  it('取り下げ・枠の終了・請求反映済みの記録ができる', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')
    store.cancelQuote.mockResolvedValue(true)
    store.terminateQuote.mockResolvedValue(true)
    store.markStripeSyncApplied.mockResolvedValue(true)

    expect((await adminPatch(patch(url, { quoteId: QUOTE_ID, action: 'cancel' }))).status).toBe(200)
    expect((await adminPatch(patch(url, { quoteId: QUOTE_ID, action: 'terminate' }))).status).toBe(200)
    expect((await adminPatch(patch(url, { quoteId: QUOTE_ID, action: 'markApplied' }))).status).toBe(200)
  })

  it('未知の action は400', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')
    const res = await adminPatch(patch(url, { quoteId: QUOTE_ID, action: 'delete' }))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/admin/quotes/export（経理向けCSV）', () => {
  it('superadmin でなければ403（金額の一覧は運営だけのもの）', async () => {
    mockVerifySuperadmin.mockResolvedValue(null)
    const res = await exportCsv()
    expect(res.status).toBe(403)
    expect(store.listApprovedQuotesWithOrg).not.toHaveBeenCalled()
  })

  it('CSVをダウンロードとして返す（ファイル名つき・Excel想定）', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')
    store.listApprovedQuotesWithOrg.mockResolvedValue([
      {
        id: 'q1',
        orgId: 'org-1',
        orgName: 'テスト事務所',
        amountMonthlyJpy: 5000,
        addMembers: 10,
        addLineGroups: 0,
        addExternalChatGroups: 0,
        approvedAt: '2026-07-26T01:23:45.000Z',
        stripeSyncStatus: 'pending',
      },
    ])

    const res = await exportCsv()

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment')
    const body = await res.text()
    expect(body).toContain('テスト事務所')
    expect(body).toContain('5000')
  })

  it('0件でも見出しだけのCSVを返す（空レスポンスにしない）', async () => {
    mockVerifySuperadmin.mockResolvedValue('admin-1')
    store.listApprovedQuotesWithOrg.mockResolvedValue([])

    const res = await exportCsv()

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('組織名')
  })
})
