import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { ClientLinkPanel } from '@/components/secretary/ClientLinkPanel'

/**
 * ClientLinkPanel — 連携ハブの「顧問先をつなぐ」カード。
 * useUserSpaces で org 内の space を選び、選択中 space に対して
 * LineFriendQr(友だち追加) ＋ LinkCodeIssueButton(突合コード発行) を出す。
 * identity(本人特定)・コード発行APIは一切変えない（既存コンポーネントをそのまま再利用）。
 */

vi.mock('qrcode', () => ({ toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,FAKE') }))

const ORG = '11111111-1111-4111-8111-111111111111'

const mockUseUserSpaces = vi.fn()
vi.mock('@/lib/hooks/useUserSpaces', () => ({
  useUserSpaces: (...args: unknown[]) => mockUseUserSpaces(...args),
}))

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(screen.getByText('確認コードを発行')).toBeInTheDocument()
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

    expect(screen.queryByText('確認コードを発行')).not.toBeInTheDocument()
  })
})
