import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QuoteCard } from '@/components/billing/QuoteCard'

/**
 * 枠追加のお見積もりカード（顧客側）。
 * 承認は支払いの約束なので、**表示している金額をそのままサーバへ返す**ことを回帰で固定する
 * （提示が差し替わった古い画面から、意図しない金額が承認されるのを防ぐ仕掛け）。
 */

const ORG_ID = '11111111-2222-3333-4444-555555555555'
const fetchMock = vi.fn()

function offeredQuote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'quote-1',
    org_id: ORG_ID,
    status: 'offered',
    amount_monthly_jpy: 5000,
    add_members: 10,
    add_line_groups: 0,
    add_external_chat_groups: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = fetchMock as unknown as typeof fetch
})

describe('QuoteCard', () => {
  it('owner でなければ何も出さない（金額と承認は owner のもの）', () => {
    const { container } = render(<QuoteCard orgId={ORG_ID} isOwner={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('提示中の見積もりは金額と内訳を出す', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ quotes: [offeredQuote()] }) })

    render(<QuoteCard orgId={ORG_ID} isOwner />)

    expect(await screen.findByText(/月額 \+¥5,000/)).toBeInTheDocument()
    expect(screen.getByText(/メンバーを 10 人ぶん追加/)).toBeInTheDocument()
    // 「いつから請求に乗るか」を必ず明示する（請求サプライズ防止）
    expect(screen.getByText(/次回の請求分から/)).toBeInTheDocument()
  })

  it('承認すると、表示中の金額をそのまま返す', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ quotes: [offeredQuote()] }) })
    render(<QuoteCard orgId={ORG_ID} isOwner />)
    await screen.findByText(/月額 \+¥5,000/)

    fireEvent.click(screen.getByRole('button', { name: 'この内容で承認する' }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/billing/quotes/quote-1'))
      expect(call).toBeTruthy()
      expect(JSON.parse(call![1].body)).toEqual({ orgId: ORG_ID, action: 'approve', amount: 5000 })
    })
  })

  it('依頼中は「作成しています」を出し、承認ボタンは出さない', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ quotes: [offeredQuote({ status: 'requested', amount_monthly_jpy: null })] }),
    })

    render(<QuoteCard orgId={ORG_ID} isOwner />)

    expect(await screen.findByText(/お見積もりを作成しています/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'この内容で承認する' })).not.toBeInTheDocument()
  })

  it('進行中が無ければ依頼フォームを出し、入力が空の間は送信できない', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ quotes: [] }) })

    render(<QuoteCard orgId={ORG_ID} isOwner />)

    const button = await screen.findByRole('button', { name: 'お見積もりを依頼する' })
    expect(button).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'メンバーをあと10人' } })
    await waitFor(() => expect(button).toBeEnabled())
  })
})
