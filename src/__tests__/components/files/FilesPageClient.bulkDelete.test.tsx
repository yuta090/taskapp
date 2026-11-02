import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { FilesPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/FilesPageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canManageFiles: canManage }),
}))
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' } }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

const mockFiles: ProjectFile[] = []
let canManage = true
const deleteManyMutateAsync = vi.fn()

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isLoading: false, hasMore: false }),
  useFileSearch: () => ({ data: undefined, hasMore: false, isFetching: false, isError: false }),
  useUploadFile: () => ({ mutateAsync: vi.fn() }),
  useUpdateFile: () => ({ mutate: vi.fn() }),
  useDeleteFile: () => ({ mutateAsync: vi.fn() }),
  useDeleteFiles: () => ({ mutateAsync: deleteManyMutateAsync, isPending: false }),
  formatFileSize: () => '1 KB',
}))

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

function checkbox(id: string) {
  return screen.getByTestId(`file-select-${id}`) as HTMLInputElement
}

function selectAll() {
  return screen.getByTestId('files-select-all') as HTMLInputElement
}

async function confirmDelete() {
  fireEvent.click(screen.getByTestId('files-bulk-delete'))
  fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '削除' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFiles.length = 0
  mockFiles.push(makeFile('f1', '資料A.pdf'), makeFile('f2', '資料B.pdf'), makeFile('f3', '別紙.pdf'))
  deleteManyMutateAsync.mockImplementation(async ({ fileIds }: { fileIds: string[] }) => ({
    deletedIds: fileIds,
    failedIds: [],
  }))
  canManage = true
})

function renderPage() {
  render(<FilesPageClient orgId="org-1" spaceId="space-1" />)
}

describe('ファイルのまとめて削除', () => {
  it('何も選んでいないと操作バーは出ない。チェックすると件数つきで出る', () => {
    renderPage()
    expect(screen.queryByTestId('files-bulk-bar')).not.toBeInTheDocument()

    fireEvent.click(checkbox('f1'))
    fireEvent.click(checkbox('f2'))

    expect(screen.getByTestId('files-bulk-bar')).toHaveTextContent('2件選択')
  })

  it('確認すると選んだファイルだけ削除し、選択を解除する', async () => {
    renderPage()
    fireEvent.click(checkbox('f1'))
    fireEvent.click(checkbox('f3'))

    await confirmDelete()

    await waitFor(() => {
      expect(deleteManyMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', fileIds: ['f1', 'f3'] })
      )
    })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('2件のファイルを削除しました'))
    expect(checkbox('f1').checked).toBe(false)
    expect(screen.queryByTestId('files-bulk-bar')).not.toBeInTheDocument()
  })

  it('削除中は進み具合を出し、押し直せない', async () => {
    renderPage()
    let finish: (value: unknown) => void = () => {}
    deleteManyMutateAsync.mockImplementation(({ onProgress }: { onProgress: (done: number) => void }) => {
      onProgress(1)
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    fireEvent.click(checkbox('f1'))
    fireEvent.click(checkbox('f2'))

    await confirmDelete()

    await waitFor(() => expect(screen.getByTestId('files-bulk-delete')).toHaveTextContent('削除中... 1/2件'))
    expect(screen.getByTestId('files-bulk-delete')).toBeDisabled()

    finish({ deletedIds: ['f1', 'f2'], failedIds: [] })
    await waitFor(() => expect(screen.queryByTestId('files-bulk-bar')).not.toBeInTheDocument())
  })

  it('確認ダイアログに件数とファイル名を出す', async () => {
    renderPage()
    fireEvent.click(checkbox('f1'))
    fireEvent.click(checkbox('f2'))
    fireEvent.click(screen.getByTestId('files-bulk-delete'))

    await screen.findByRole('alertdialog')
    expect(screen.getByText(/資料A\.pdf.*資料B\.pdf.*2件.*取り消せません/)).toBeInTheDocument()
  })

  it('キャンセルすると削除せず、選択も残す', async () => {
    renderPage()
    fireEvent.click(checkbox('f1'))
    fireEvent.click(screen.getByTestId('files-bulk-delete'))
    await screen.findByRole('alertdialog')

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(deleteManyMutateAsync).not.toHaveBeenCalled()
    expect(checkbox('f1').checked).toBe(true)
  })

  it('一部失敗したら、失敗した分だけ選択に残して件数を知らせる', async () => {
    renderPage()
    deleteManyMutateAsync.mockResolvedValue({ deletedIds: ['f1'], failedIds: ['f2'] })
    fireEvent.click(checkbox('f1'))
    fireEvent.click(checkbox('f2'))

    await confirmDelete()

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('1件のファイルを削除できませんでした'))
    expect(toastSuccess).toHaveBeenCalledWith('1件のファイルを削除しました')
    expect(checkbox('f1').checked).toBe(false)
    expect(checkbox('f2').checked).toBe(true)
  })

  it('全選択は表示中のファイルだけを選び、もう一度押すと外す', () => {
    renderPage()
    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '資料' } })

    fireEvent.click(selectAll())
    expect(screen.getByTestId('files-bulk-bar')).toHaveTextContent('2件選択')
    expect(selectAll().checked).toBe(true)

    fireEvent.click(selectAll())
    expect(screen.queryByTestId('files-bulk-bar')).not.toBeInTheDocument()
  })

  it('一部だけ選ぶと全選択は中間表示になる', () => {
    renderPage()
    fireEvent.click(checkbox('f1'))

    expect(selectAll().indeterminate).toBe(true)
    expect(selectAll().checked).toBe(false)
  })

  it('絞り込みで見えなくなったファイルは削除しない', async () => {
    renderPage()
    fireEvent.click(checkbox('f1'))
    fireEvent.click(checkbox('f3'))
    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '資料' } })

    expect(screen.getByTestId('files-bulk-bar')).toHaveTextContent('1件選択')

    await confirmDelete()

    await waitFor(() => {
      expect(deleteManyMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', fileIds: ['f1'] })
      )
    })
  })

  it('「選択をやめる」で選択を全部外す', () => {
    renderPage()
    fireEvent.click(checkbox('f1'))

    fireEvent.click(screen.getByRole('button', { name: '選択をやめる' }))

    expect(checkbox('f1').checked).toBe(false)
    expect(screen.queryByTestId('files-bulk-bar')).not.toBeInTheDocument()
  })
})

describe('管理者でない人のまとめて削除', () => {
  beforeEach(() => {
    canManage = false
    mockFiles.length = 0
    mockFiles.push(makeFile('mine', '自分の.pdf'), { ...makeFile('other', '他の人の.pdf'), uploadedBy: 'u2' })
    renderPage()
  })

  it('他の人のファイルはチェックできず、全選択にも入らない', async () => {
    expect(checkbox('other')).toBeDisabled()
    expect(screen.queryByTestId('file-delete-other')).not.toBeInTheDocument()

    fireEvent.click(selectAll())
    expect(screen.getByTestId('files-bulk-bar')).toHaveTextContent('1件選択')

    await confirmDelete()
    await waitFor(() => {
      expect(deleteManyMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ fileIds: ['mine'] }))
    })
  })
})
