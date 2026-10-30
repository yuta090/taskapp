import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockOrg = vi.fn()
const mockSpace = vi.fn()
vi.mock('@/lib/hooks/useStorageUsage', () => ({
  useOrgStorageUsage: (...args: unknown[]) => mockOrg(...args),
  useSpaceStorageUsage: (...args: unknown[]) => mockSpace(...args),
}))

import { StorageBreakdownCard } from '@/components/storage/StorageBreakdownCard'
import { SpaceStorageUsage } from '@/components/storage/SpaceStorageUsage'

const ORG_ID = '11111111-2222-3333-4444-555555555555'
const MB = 1024 * 1024

beforeEach(() => {
  vi.clearAllMocks()
})

describe('StorageBreakdownCard（プランと請求）', () => {
  it('社内メンバーでなければ何も出さず、取りにも行かない', () => {
    mockOrg.mockReturnValue({ data: undefined, isPending: true, error: null })
    const { container } = render(<StorageBreakdownCard orgId={ORG_ID} canView={false} />)
    expect(container).toBeEmptyDOMElement()
    expect(mockOrg).toHaveBeenCalledWith(ORG_ID, false)
  })

  it('プロジェクトごとの使用量とファイル数、チャットの添付を出す。名前はファイル一覧へのリンク', () => {
    mockOrg.mockReturnValue({
      data: {
        total_bytes: 7 * MB,
        chat_attachments_bytes: 1 * MB,
        spaces: [
          { space_id: 's1', name: 'A案件', bytes: 5 * MB, file_count: 3 },
          { space_id: 's2', name: 'B案件', bytes: 1 * MB, file_count: 1 },
        ],
      },
      isPending: false,
      error: null,
    })
    render(<StorageBreakdownCard orgId={ORG_ID} canView />)

    expect(screen.getByText('合計 7 MB')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'A案件' })).toHaveAttribute(
      'href',
      `/${ORG_ID}/project/s1/files`,
    )
    expect(screen.getByText('5 MB（3件）')).toBeInTheDocument()
    expect(screen.getByText('チャットの添付ファイル')).toBeInTheDocument()
  })

  it('チャットの添付が無ければその行は出さない', () => {
    mockOrg.mockReturnValue({
      data: { total_bytes: 0, chat_attachments_bytes: 0, spaces: [] },
      isPending: false,
      error: null,
    })
    render(<StorageBreakdownCard orgId={ORG_ID} canView />)
    expect(screen.queryByText('チャットの添付ファイル')).not.toBeInTheDocument()
    expect(screen.getByText('まだファイルはありません')).toBeInTheDocument()
  })
})

describe('SpaceStorageUsage（プロジェクト設定）', () => {
  it('このプロジェクトの使用量とファイル数を出す', () => {
    mockSpace.mockReturnValue({
      data: { space_id: 's1', bytes: 5 * MB, file_count: 3 },
      isPending: false,
      error: null,
    })
    render(<SpaceStorageUsage orgId={ORG_ID} spaceId="s1" />)
    expect(screen.getByText('5 MB')).toBeInTheDocument()
    expect(screen.getByText('ファイル 3件')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ファイル一覧を開く/ })).toHaveAttribute(
      'href',
      `/${ORG_ID}/project/s1/files`,
    )
  })

  it('読み込めなかったときはその旨を出す', () => {
    mockSpace.mockReturnValue({ data: undefined, isPending: false, error: new Error('x') })
    render(<SpaceStorageUsage orgId={ORG_ID} spaceId="s1" />)
    expect(screen.getByText('ディスク使用量を読み込めませんでした')).toBeInTheDocument()
  })
})
