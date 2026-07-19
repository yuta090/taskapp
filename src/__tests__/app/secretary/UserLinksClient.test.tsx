import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { UserLinksClient } from '@/app/(internal)/[orgId]/secretary/connect/line/UserLinksClient'

/**
 * UserLinksClient — LINE連携ハブ（1画面3カード）。
 *
 * 「自分をつなぐ/顧問先をつなぐ/グループをつなぐ」がタブに分散して分かりにくかったため、
 * 1画面に3カードで並べ、提示レイヤーだけを統合する（Fable設計 D3）。
 * identity・API・トークン発行ロジックは各カードの中身(SelfLinkPanel/ClientLinkPanel/
 * GroupLinkPanel)が既存のまま呼ぶだけで、ここでは並べ方の統合のみを検証する。
 */

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: React.ComponentProps<'a'> & { href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') }))

const ORG = '11111111-1111-4111-8111-111111111111'
const fetchMock = vi.fn()

const mockUseUserSpaces = vi.fn()
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (...args: unknown[]) => mockUseUserSpaces(...args),
}))

vi.mock('@/lib/hooks/useChannelIdentities', () => ({
  useChannelIdentities: () => ({ counts: {}, isLoading: false, error: null }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  mockUseUserSpaces.mockReturnValue({ spaces: [], loading: false, error: null, refetch: vi.fn() })
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/channels/accounts')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ account: null }) })
    }
    if (url.includes('/api/channels/user-links')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ links: [] }) })
    }
    if (url.includes('/api/channels/line/basic-id')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ basicId: '@abc1234', ownerType: 'org' }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
})

describe('UserLinksClient (連携ハブ)', () => {
  it('3カードの見出しが表示される(自分/相手先/グループ)', () => {
    render(<UserLinksClient orgId={ORG} />)

    expect(screen.getByText(/自分をつなぐ/)).toBeInTheDocument()
    expect(screen.getByText(/相手先をつなぐ/)).toBeInTheDocument()
    expect(screen.getByText(/グループをつなぐ/)).toBeInTheDocument()
  })

  it('タブ・チャネルレールはlayoutが持つため、Client自身はタブを描画しない(二重nav禁止)', () => {
    render(<UserLinksClient orgId={ORG} />)

    expect(screen.queryByTestId('secretary-tab-connect')).not.toBeInTheDocument()
  })

  it('グループカードのCTAは connect/line/groups ページへリンクする', () => {
    render(<UserLinksClient orgId={ORG} />)

    const cta = screen.getByRole('link', { name: /グループ紐付けを管理する/ })
    expect(cta).toHaveAttribute('href', `/${ORG}/secretary/connect/line/groups`)
  })
})
