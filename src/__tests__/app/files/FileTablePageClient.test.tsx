import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { FileTablePageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/[fileId]/FileTablePageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'
import type { FileTableResult } from '@/lib/hooks/useFileTable'
import { FileTableConflictError } from '@/lib/hooks/useSaveFileTable'

/**
 * ファイル→表のページ。
 * - ファイル一覧のキャッシュ(useFiles)から名前を出し、中身は useFileTable で取る
 * - 直せる人(社内メンバー)には編集グリッドを出し、直したら少し待って自動保存する
 * - 別の場所で更新されていたら帯を出して自動保存を止める(黙って上書きしない)
 * - 開けないときは理由とダウンロードの逃げ道を出す
 */

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 36, size: 36 })),
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {},
  }),
}))

const mockFiles: ProjectFile[] = []
let tableState: {
  data: FileTableResult | undefined
  isPending: boolean
  error: Error | null
  refetch: () => void
}
let canEdit = true
const saveTableMock = vi.fn()

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isPending: false }),
}))
vi.mock('@/lib/hooks/useFileTable', () => ({
  useFileTable: () => tableState,
}))
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit, canEditMoney: false, loading: false, resolved: true }),
}))
vi.mock('@/lib/hooks/useSaveFileTable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSaveFileTable')>()
  return { ...actual, useSaveFileTable: () => ({ saveTable: saveTableMock }) }
})

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'f1',
    name: 'ターゲット一覧.csv',
    description: null,
    mimeType: 'text/csv',
    sizeBytes: 2048,
    origin: 'internal',
    clientVisible: false,
    uploadedBy: 'u1',
    uploaderName: '田中太郎',
    createdAt: '2026-09-01T00:00:00',
    ...overrides,
  }
}

function loaded(overrides: Partial<FileTableResult> = {}) {
  return {
    data: {
      table: { columns: ['会社名', '県'], rows: [['A社', '広島県']] },
      encoding: 'utf-8' as const,
      updatedAt: '2026-09-17T00:00:00.000Z',
      delimiter: ',' as const,
      ...overrides,
    },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }
}

beforeEach(() => {
  mockFiles.length = 0
  mockFiles.push(makeFile())
  tableState = { data: undefined, isPending: true, error: null, refetch: vi.fn() }
  canEdit = true
  saveTableMock.mockReset()
  saveTableMock.mockResolvedValue({ updatedAt: '2026-09-17T01:00:00.000Z' })
})

function renderPage() {
  return render(<FileTablePageClient orgId="org-1" spaceId="space-1" fileId="f1" />)
}

/** セルを直して、自動保存の待ち時間を進める */
async function editFirstCell(value: string) {
  fireEvent.click(screen.getAllByRole('cell')[0])
  const input = screen.getByRole('textbox')
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await act(async () => {
    vi.advanceTimersByTime(2000)
  })
}

describe('FileTablePageClient 表示', () => {
  it('読み込み中はローディングを出す', () => {
    renderPage()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('ファイル名をパンくずに出し、表を表示する', () => {
    tableState = loaded()
    renderPage()

    expect(screen.getByText('ターゲット一覧.csv')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /会社名/ })).toBeInTheDocument()
    expect(screen.getByText('A社')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ファイル' })).toHaveAttribute('href', '/org-1/project/space-1/files')
    expect(screen.getByRole('link', { name: /ダウンロード/ })).toHaveAttribute('href', '/api/files/f1/download')
  })

  it('Shift_JIS で読んだときはその旨を小さく出す', () => {
    tableState = loaded({ encoding: 'shift_jis' })
    renderPage()
    expect(screen.getByText(/Shift_JIS/)).toBeInTheDocument()
  })

  it('開けないときは理由とダウンロードの逃げ道を出す', () => {
    tableState = {
      data: undefined,
      isPending: false,
      error: new Error('このファイルは大きすぎるため表として開けません(上限10MB)。ダウンロードして開いてください'),
      refetch: vi.fn(),
    }
    renderPage()
    expect(screen.getByText(/大きすぎる/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ダウンロード/ })).toHaveAttribute('href', '/api/files/f1/download')
  })
})

describe('FileTablePageClient 直せるかどうか', () => {
  it('社内メンバーは直せる', () => {
    tableState = loaded()
    renderPage()
    expect(screen.getByRole('button', { name: '行を追加' })).toBeInTheDocument()
  })

  it('閲覧者・相手先は見るだけ', () => {
    canEdit = false
    tableState = loaded()
    renderPage()

    expect(screen.queryByRole('button', { name: '行を追加' })).not.toBeInTheDocument()
    expect(screen.getByText('A社')).toBeInTheDocument()
  })

  it('いまの版が分からないときは直させない(上書きで消してしまうため)', () => {
    tableState = loaded({ updatedAt: null })
    renderPage()

    expect(screen.queryByRole('button', { name: '行を追加' })).not.toBeInTheDocument()
    expect(screen.getByText(/読み込み直/)).toBeInTheDocument()
  })
})

describe('FileTablePageClient 自動保存', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('セルを直すと、少し待ってから保存する(保存ボタンは無い)', async () => {
    tableState = loaded()
    renderPage()

    await editFirstCell('B社')

    expect(screen.queryByRole('button', { name: /保存/ })).not.toBeInTheDocument()
    expect(saveTableMock).toHaveBeenCalledTimes(1)
    const params = saveTableMock.mock.calls[0][0]
    expect(params.fileId).toBe('f1')
    expect(params.baseUpdatedAt).toBe('2026-09-17T00:00:00.000Z')
    expect(params.delimiter).toBe(',')
    expect(params.table.rows[0]).toEqual(['B社', '広島県'])
  })

  it('続けて直しても、まとめて1回だけ保存する', async () => {
    tableState = loaded()
    renderPage()

    fireEvent.click(screen.getAllByRole('cell')[0])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'B社' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    fireEvent.click(screen.getAllByRole('cell')[1])
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '岡山県' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(saveTableMock).toHaveBeenCalledTimes(1)
  })

  it('2回目の保存は、1回目で返ってきた版を基準にする', async () => {
    tableState = loaded()
    renderPage()

    await editFirstCell('B社')
    await editFirstCell('C社')

    expect(saveTableMock).toHaveBeenCalledTimes(2)
    expect(saveTableMock.mock.calls[1][0].baseUpdatedAt).toBe('2026-09-17T01:00:00.000Z')
  })

  it('別の場所で更新されていたら帯を出し、以後の自動保存を止める', async () => {
    tableState = loaded()
    saveTableMock.mockRejectedValue(new FileTableConflictError())
    renderPage()

    await editFirstCell('B社')

    await waitFor(() => expect(screen.getByText(/別の場所で更新/)).toBeInTheDocument())

    await editFirstCell('C社')
    expect(saveTableMock).toHaveBeenCalledTimes(1)
  })

  it('競合したら、書きかけを取り出せる逃げ道と読み直しを出す', async () => {
    const refetch = vi.fn()
    tableState = { ...loaded(), refetch }
    saveTableMock.mockRejectedValue(new FileTableConflictError())
    renderPage()

    await editFirstCell('B社')
    await waitFor(() => expect(screen.getByText(/別の場所で更新/)).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /書きかけをコピー/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /最新を読み込む/ }))
    expect(refetch).toHaveBeenCalled()
  })
})
