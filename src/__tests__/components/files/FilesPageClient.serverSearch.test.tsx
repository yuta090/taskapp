import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FilesPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/FilesPageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 上限(500件)を超えるスペースでは、一覧に載っていない古いファイルも探せるよう
 * 検索をサーバーに投げる。上限内のスペースでは今までどおり手元で絞る(速いまま)。
 */

// お知らせベルがヘッダーに入ったので、その取得層(react-query)を差し替える。
// 差し替えないと QueryClientProvider の無いテストが「No QueryClient set」で落ちる。
vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/lib/files/limits', () => ({ FILES_LIST_LIMIT: 2 }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockFiles: ProjectFile[] = []
const searchResults: ProjectFile[] = []
let listHasMore = false
let searchHasMore = false
let searchIsPlaceholder = false
let searchEnabledCalls: Array<{ query: Record<string, unknown>; enabled: boolean }> = []

vi.mock('@/lib/hooks/useFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useFiles')>()
  const uploadMutateAsync = vi.fn()
  const updateMutate = vi.fn()
  const deleteMutateAsync = vi.fn()
  return {
    ...actual,
    useFiles: () => ({ data: mockFiles, isLoading: false, hasMore: listHasMore }),
    useFileSearch: (
      _spaceId: string,
      query: Record<string, unknown>,
      { enabled }: { enabled: boolean }
    ) => {
      searchEnabledCalls.push({ query, enabled })
      return {
        data: enabled ? searchResults : undefined,
        hasMore: enabled ? searchHasMore : false,
        isPlaceholderData: enabled ? searchIsPlaceholder : false,
        isFetching: false,
        isError: false,
      }
    },
    useUploadFile: () => ({ mutateAsync: uploadMutateAsync }),
    useUpdateFile: () => ({ mutate: updateMutate }),
    useDeleteFile: () => ({ mutateAsync: deleteMutateAsync }),
    formatFileSize: () => '1 KB',
  }
})

function makeFile(id: string, name: string): ProjectFile {
  return {
    id,
    name,
    description: null,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    origin: 'internal',
    clientVisible: false,
    uploadedBy: 'u1',
    uploaderName: '田中太郎',
    createdAt: '2026-07-01T00:00:00',
  }
}

function renderPage() {
  return render(<FilesPageClient orgId="org-1" spaceId="space-1" />)
}

function lastSearchCall() {
  return searchEnabledCalls[searchEnabledCalls.length - 1]
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  mockFiles.length = 0
  searchResults.length = 0
  listHasMore = false
  searchHasMore = false
  searchIsPlaceholder = false
  searchEnabledCalls = []
})

afterEach(() => vi.useRealTimers())

describe('FilesPageClient — 上限内のスペース', () => {
  it('サーバー検索は使わない(手元で絞るほうが速い)', () => {
    mockFiles.push(makeFile('f1', '資料.pdf'))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '資料' } })
    act(() => { vi.advanceTimersByTime(600) })

    expect(lastSearchCall().enabled).toBe(false)
  })

  it('「500件まで」のお知らせは出さない', () => {
    mockFiles.push(makeFile('f1', '資料.pdf'))
    renderPage()
    expect(screen.queryByTestId('files-limit-notice')).not.toBeInTheDocument()
  })
})

describe('FilesPageClient — 上限を超えるスペース', () => {
  beforeEach(() => {
    listHasMore = true
    mockFiles.push(makeFile('f1', '新しい資料.pdf'), makeFile('f2', '新しいメモ.pdf'))
  })

  it('一覧に載っていない古いファイルがあることを伝える', () => {
    renderPage()
    expect(screen.getByTestId('files-limit-notice')).toHaveTextContent('新しい順に2件まで')
  })

  it('検索するとサーバーに問い合わせる。ただし打鍵のたびには投げない', () => {
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古' } })
    expect(lastSearchCall().enabled).toBe(false)

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古い' } })
    act(() => { vi.advanceTimersByTime(600) })

    expect(lastSearchCall()).toMatchObject({ enabled: true, query: { q: '古い' } })
  })

  it('サーバーが返した結果を一覧に出す(手元の500件に無いファイルも出る)', () => {
    searchResults.push(makeFile('old-1', '古い議事録.pdf'))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古い' } })
    act(() => { vi.advanceTimersByTime(600) })

    expect(screen.getByText('古い議事録.pdf')).toBeInTheDocument()
    expect(screen.queryByText('新しい資料.pdf')).not.toBeInTheDocument()
  })

  it('サーバーの結果にも、種類などの絞り込みを重ねてかける', () => {
    searchResults.push(makeFile('old-1', '古い議事録.pdf'), makeFile('old-2', '古い一覧.csv'))
    searchResults[1].mimeType = 'text/csv'
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古い' } })
    fireEvent.change(screen.getByTestId('files-filter-kind'), { target: { value: 'table' } })
    act(() => { vi.advanceTimersByTime(600) })

    expect(screen.getByText('古い一覧.csv')).toBeInTheDocument()
    expect(screen.queryByText('古い議事録.pdf')).not.toBeInTheDocument()
  })

  it('該当が多すぎるときは、もっと絞るよう伝える', () => {
    searchHasMore = true
    searchResults.push(makeFile('old-1', '古い議事録.pdf'))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古い' } })
    act(() => { vi.advanceTimersByTime(600) })

    expect(screen.getByTestId('files-search-truncated')).toHaveTextContent('多すぎ')
  })

  // 検索が返るまでの「前の結果」は全件一覧のもの。全件が上限に張り付いているから
  // サーバー検索になっているので、そのまま出すと毎回かならず一瞬点滅する
  it('検索の結果を待っている間は「多すぎます」を出さない', () => {
    searchHasMore = true
    searchIsPlaceholder = true
    searchResults.push(makeFile('old-1', '古い議事録.pdf'))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古い' } })
    act(() => { vi.advanceTimersByTime(600) })

    expect(screen.queryByTestId('files-search-truncated')).not.toBeInTheDocument()
  })

  it('条件を消したら全件の一覧に戻る', () => {
    searchResults.push(makeFile('old-1', '古い議事録.pdf'))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '古い' } })
    act(() => { vi.advanceTimersByTime(600) })
    fireEvent.click(screen.getByTestId('files-filter-clear'))
    act(() => { vi.advanceTimersByTime(600) })

    expect(lastSearchCall().enabled).toBe(false)
    expect(screen.getByText('新しい資料.pdf')).toBeInTheDocument()
  })
})
