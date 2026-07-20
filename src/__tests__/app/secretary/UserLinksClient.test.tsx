import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { UserLinksClient } from '@/app/(internal)/[orgId]/secretary/connect/line/UserLinksClient'

/**
 * UserLinksClient — LINE連携ハブ。
 *
 * 高校生でも分かる言葉で主役2カード（グループLINEから拾う / 自分のLINEで受け取る）を
 * 並べ、1対1(相手先)は「グループを介さず直接つなぐ」Pro副導線として畳んで置く。
 * identity・API・トークン発行ロジックは各カードの中身が既存のまま呼ぶだけで、
 * ここでは並べ方・言葉・畳み方の統合のみを検証する。
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
  it('主役2カードを平易な見出しで、順番はグループ→自分で表示する', () => {
    render(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    const group = screen.getByText('グループLINEから拾う')
    const self = screen.getByText('自分のLINEで受け取る')
    expect(group).toBeInTheDocument()
    expect(self).toBeInTheDocument()
    // グループが自分より先(上)に来る
    expect(group.compareDocumentPosition(self) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('1対1(相手先)はPro副導線として畳まれ、既定ではClientLinkPanelを出さない', () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    // トグルは見えるが、中身(相手先の選択UI)は開くまで出さない
    expect(screen.getByTestId('direct-connect-toggle')).toHaveTextContent('相手と1対1でつなぐ')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('direct-connect-toggle'))
    // 開くと相手先の選択UI(ClientLinkPanel)が出る
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('タブ・チャネルレールはlayoutが持つため、Client自身はタブを描画しない(二重nav禁止)', () => {
    render(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    expect(screen.queryByTestId('secretary-tab-connect')).not.toBeInTheDocument()
  })

  it('グループカードのCTAは connect/line/groups ページへリンクする', () => {
    render(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    const cta = screen.getByRole('link', { name: /グループ紐付けを管理する/ })
    expect(cta).toHaveAttribute('href', `/${ORG}/secretary/connect/line/groups`)
  })
})
