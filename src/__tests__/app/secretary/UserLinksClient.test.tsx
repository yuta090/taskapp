import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserLinksClient } from '@/app/(internal)/[orgId]/secretary/connect/line/UserLinksClient'

/**
 * UserLinksClient — LINE連携ハブ。
 *
 * 初心者が迷わない順に並べる: メリット1文 → 「1. 自分のLINEをつなぐ」(ここで完結) →
 * 「2. 相手先とのグループLINEをつなぐ」(専用画面へ) → 補助情報(使い方・送信量)。
 * 1対1(相手先)は「グループを介さず直接つなぐ」Pro副導線として畳んで置く。
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

// 送信量パネルは view が無いと何も描画しないため、並び順の検証用に固定の view を返す
vi.mock('@/lib/hooks/useSharedLineUsage', () => ({
  useSharedLineUsage: () => ({
    loading: false,
    view: { unlimited: false, used: 3, quota: 200, remaining: 197, ratio: 0.015, level: 'ok' },
  }),
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

/**
 * ハブ内の SharedLineUsagePanel が react-query を使うため、Provider 無しで render すると
 * 「No QueryClient set」で落ちる。アプリ側では QueryProvider が上位にいるので、テストでも
 * 同じ前提を再現する（他の client テストと同じ流儀）。
 */
function renderHub(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('UserLinksClient (連携ハブ)', () => {
  it('冒頭に「つなぐと何ができるか」を1文で言う', () => {
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    const lead = screen.getByTestId('line-connect-lead')
    expect(lead).toHaveTextContent('タスク')
    expect(lead).toHaveTextContent('承認')
  })

  it('番号付きの2ステップを「1. 自分のLINE」→「2. グループLINE」の順で出し、各ステップに1文の説明を添える', () => {
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    const self = screen.getByRole('heading', { name: /1\. 自分のLINEをつなぐ/ })
    const group = screen.getByRole('heading', { name: /2\. 相手先とのグループLINEをつなぐ/ })
    expect(self.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    expect(screen.getByTestId('line-step-self')).toHaveTextContent('あなたのLINEに届く')
    expect(screen.getByTestId('line-step-group')).toHaveTextContent('自動でタスク')
  })

  it('補助情報（使い方・今月の送信量）は2ステップより後ろに置く', () => {
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    const group = screen.getByTestId('line-step-group')
    const guide = screen.getByText('使い方（コマンド一覧）')
    const usage = screen.getByText('今月の共通LINE送信')
    expect(group.compareDocumentPosition(guide) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(group.compareDocumentPosition(usage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('QRは自分のLINE用の1つだけ（グループ用のQRを同じ画面に重ねて出さない）', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/channels/accounts')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ account: { id: 'acc-1', displayName: 'AgentPM秘書' } }) })
      }
      if (url.includes('/api/channels/user-links')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ links: [] }) })
      }
      if (url.includes('/api/channels/line/basic-id')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ basicId: '@abc1234', ownerType: 'platform' }) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
    })
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    expect(await screen.findAllByRole('img', { name: /QR/ })).toHaveLength(1)
    // 共有アカウントであることの注意書きは出さない（不安を煽るだけで、手順は変わらない）
    expect(screen.queryByText(/ほかの事務所/)).not.toBeInTheDocument()
    expect(screen.queryByText(/共通の秘書アカウント/)).not.toBeInTheDocument()
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
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    // トグルは見えるが、中身(相手先の選択UI)は開くまで出さない
    expect(screen.getByTestId('direct-connect-toggle')).toHaveTextContent('相手先の担当者と1対1でつなぐ')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('direct-connect-toggle'))
    // 開くと相手先の選択UI(ClientLinkPanel)が出る
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('タブ・チャネルレールはlayoutが持つため、Client自身はタブを描画しない(二重nav禁止)', () => {
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    expect(screen.queryByTestId('secretary-tab-connect')).not.toBeInTheDocument()
  })

  it('グループのCTAは connect/line/groups ページへリンクする', () => {
    renderHub(<UserLinksClient orgId={ORG} lineAccess="granted" />)

    const cta = screen.getByRole('link', { name: /グループをつなぐ/ })
    expect(cta).toHaveAttribute('href', `/${ORG}/secretary/connect/line/groups`)
  })

  it('未申込(none): メリット1文＋「利用を申し込む」ボタンだけを出し、つなぎ方の手順は出さない', () => {
    renderHub(<UserLinksClient orgId={ORG} lineAccess="none" />)

    expect(screen.getByTestId('line-connect-lead')).toHaveTextContent('タスク')
    expect(screen.getByRole('button', { name: '利用を申し込む' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /自分のLINEをつなぐ/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/共通の秘書アカウント/)).not.toBeInTheDocument()
  })

  it('申込中(requested)/準備中(unavailable): 開通したらメールで知らせる旨だけを短く出す', () => {
    const { unmount } = renderHub(<UserLinksClient orgId={ORG} lineAccess="requested" />)
    expect(screen.getByText(/申込を受け付けました/)).toBeInTheDocument()
    expect(screen.getByText(/メールでお知らせ/)).toBeInTheDocument()
    unmount()

    renderHub(<UserLinksClient orgId={ORG} lineAccess="unavailable" />)
    expect(screen.getByText(/準備中です/)).toBeInTheDocument()
    expect(screen.getByText(/メールでお知らせ/)).toBeInTheDocument()
  })
})
