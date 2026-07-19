import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'

/**
 * GroupLinkPanel — 連携ハブの「グループをつなぐ」カード。
 * グループ紐付けは一括発行/承認待ちなど複雑なため、ハブ内では完全に再現せず
 * 友だち追加QR＋手順の案内＋既存の group-links ページへの誘導CTAだけを出す（軽量）。
 */

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') }))
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const ORG = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ basicId: '@abc1234', ownerType: 'org' }),
  })
})

describe('GroupLinkPanel', () => {
  it('friend QR(purpose=group)と手順、group-linksへのCTAリンクを表示する', async () => {
    render(<GroupLinkPanel orgId={ORG} />)

    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument())
    expect(screen.getByText(/秘書を友だち追加/)).toBeInTheDocument()
    expect(screen.getByText(/LINEグループに招待/)).toBeInTheDocument()
    expect(screen.getByText(/グループのトークに送信/)).toBeInTheDocument()

    const cta = screen.getByRole('link', { name: /グループ紐付けを管理する/ })
    expect(cta).toHaveAttribute('href', `/${ORG}/secretary/connect/line/groups`)
  })
})
