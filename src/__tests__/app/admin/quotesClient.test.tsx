import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QuotesClient } from '@/app/admin/(panel)/quotes/QuotesClient'
import type { BillingQuoteRow } from '@/lib/billing/quotes'
import type { ApprovedQuoteWithOrg } from '@/lib/billing/quotesCsv'

/**
 * 当社側の見積もり画面。
 *
 * 「反映済みにする」を押したあと、承認済み一覧（＝毎月いくら請求するかの表）が
 * 古いままだと、担当者は反映したのに「未反映」を見続けて二重に作業する。
 * 押したら取り直すことを固定する。
 */

const PENDING: BillingQuoteRow = {
  id: '11111111-1111-1111-1111-111111111111',
  org_id: 'org-a',
  status: 'approved',
  requested_by: 'u1',
  requested_note: null,
  requested_at: '2026-07-01T00:00:00.000Z',
  amount_monthly_jpy: 5000,
  add_members: 10,
  add_line_groups: 0,
  add_external_chat_groups: 0,
  offer_note: null,
  offered_at: '2026-07-01T00:00:00.000Z',
  expires_at: null,
  approved_at: '2026-07-02T00:00:00.000Z',
  stripe_sync_status: 'pending',
} as unknown as BillingQuoteRow

const APPROVED: ApprovedQuoteWithOrg = {
  id: PENDING.id,
  orgId: 'org-a',
  orgName: 'A社',
  amountMonthlyJpy: 5000,
  addMembers: 10,
  addLineGroups: 0,
  addExternalChatGroups: 0,
  approvedAt: '2026-07-02T00:00:00.000Z',
  stripeSyncStatus: 'pending',
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('QuotesClient', () => {
  it('「反映済みにする」の後に承認済み一覧を取り直す', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          open: [],
          pendingSync: [],
          approved: [{ ...APPROVED, stripeSyncStatus: 'applied' }],
          approvedWarning: null,
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <QuotesClient
        initialOpen={[]}
        initialPendingSync={[PENDING]}
        initialApproved={[APPROVED]}
        initialApprovedWarning={null}
      />,
    )

    expect(screen.getByText('未反映')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '反映済みにする' }))

    await waitFor(() => expect(screen.getByText('反映済み')).toBeInTheDocument())
    expect(screen.queryByText('未反映')).not.toBeInTheDocument()
  })

  it('件数が多すぎて取り切れなかったときは警告を出す（黙って請求漏れにしない）', () => {
    vi.stubGlobal('fetch', vi.fn())

    render(
      <QuotesClient
        initialOpen={[]}
        initialPendingSync={[]}
        initialApproved={[APPROVED]}
        initialApprovedWarning="truncated"
      />,
    )

    expect(screen.getByText(/一部しか表示できていません/)).toBeInTheDocument()
  })

  it('読み込みに失敗したときは「0件」と誤解させず、読めなかったと出す', () => {
    vi.stubGlobal('fetch', vi.fn())

    render(
      <QuotesClient
        initialOpen={[]}
        initialPendingSync={[]}
        initialApproved={[]}
        initialApprovedWarning="failed"
      />,
    )

    expect(screen.getByText(/読み込めませんでした/)).toBeInTheDocument()
  })
})
