import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ClientLinkPanel } from '@/components/secretary/ClientLinkPanel'

/**
 * ClientLinkPanel — 連携ハブの「相手先をつなぐ」カード。
 * useUserSpaces で org 内の space を選び、選択中 space に対して
 * LineFriendQr(友だち追加) ＋ LinkCodeIssueButton(突合コード発行) を出す。
 * identity(本人特定)・コード発行APIは一切変えない（既存コンポーネントをそのまま再利用）。
 * 接続済み(channel_identities>0)の相手先では QR を畳み、発行ボタン(追加でつなぐ)は常時出す。
 */

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') }))

const ORG = '11111111-1111-4111-8111-111111111111'

const mockUseUserSpaces = vi.fn()
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (...args: unknown[]) => mockUseUserSpaces(...args),
}))

const mockUseChannelIdentities = vi.fn()
vi.mock('@/lib/hooks/useChannelIdentities', () => ({
  useChannelIdentities: (...args: unknown[]) => mockUseChannelIdentities(...args),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockUseChannelIdentities.mockReturnValue({ counts: {}, isLoading: false, error: null })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation((url: string) => {
    if (url.includes('/api/channels/line/basic-id')) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ basicId: '@abc1234', ownerType: 'org' }) })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
  })
})

describe('ClientLinkPanel', () => {
  it('spaceが無ければガード表示のみでQR/発行ボタンを出さない', () => {
    mockUseUserSpaces.mockReturnValue({ spaces: [], loading: false, error: null, refetch: vi.fn() })
    render(<ClientLinkPanel orgId={ORG} />)

    expect(screen.getByText(/プロジェクトがありません/)).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('org内のspaceのみをセレクタに出す(他orgは混ぜない)', () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
        { id: 'space-2', name: '他org案件', orgId: 'org-OTHER', orgName: '別事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 1 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<ClientLinkPanel orgId={ORG} />)

    expect(screen.getByText('山田商事')).toBeInTheDocument()
    expect(screen.queryByText('他org案件')).not.toBeInTheDocument()
  })

  it('spaceを選択するとQRと発行ボタンが表示される', async () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<ClientLinkPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })

    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument())
    expect(screen.getByText('本人確認コードを発行')).toBeInTheDocument()
  })

  it('未選択時はQR/発行ボタンを出さない', () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<ClientLinkPanel orgId={ORG} />)

    expect(screen.queryByText('本人確認コードを発行')).not.toBeInTheDocument()
  })

  it('接続状態ロード中はQRを出さずスケルトン表示（展開→畳みのちらつき防止）', () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseChannelIdentities.mockReturnValue({ counts: {}, isLoading: true, error: null })
    render(<ClientLinkPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })

    expect(screen.getByTestId('connect-flow-skeleton')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /QR/ })).not.toBeInTheDocument()
    expect(screen.queryByText('本人確認コードを発行')).not.toBeInTheDocument()
  })

  it('接続済みの相手先: 接続バッジと発行ボタン(追加でつなぐ)は出し、QRは畳む', async () => {
    mockUseUserSpaces.mockReturnValue({
      spaces: [
        { id: 'space-1', name: '山田商事', orgId: ORG, orgName: 'テスト事務所', role: 'admin', archivedAt: null, groupId: null, sortOrder: 0 },
      ],
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    mockUseChannelIdentities.mockReturnValue({ counts: { 'space-1': 2 }, isLoading: false, error: null })
    render(<ClientLinkPanel orgId={ORG} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'space-1' } })

    // 接続済みバッジ + 発行ボタン(追加でつなぐ)は常時表示、手順ヒントも出る
    expect(await screen.findByText(/この相手先は接続済みです（2件）/)).toBeInTheDocument()
    expect(screen.getByText('本人確認コードを発行')).toBeInTheDocument()
    // QRは畳まれていて「QRを表示」トグルの裏
    expect(screen.queryByRole('img', { name: /QR/ })).not.toBeInTheDocument()
    expect(screen.getByTestId('connect-showqr-toggle')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('connect-showqr-toggle'))
    await waitFor(() => expect(screen.getByRole('img', { name: /QR/ })).toBeInTheDocument())
  })
})
