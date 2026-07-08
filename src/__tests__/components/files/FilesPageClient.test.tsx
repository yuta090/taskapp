import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FilesPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/FilesPageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const mockFiles: ProjectFile[] = []
const uploadMutateAsync = vi.fn().mockResolvedValue({ ok: true })
const updateMutate = vi.fn()
const deleteMutateAsync = vi.fn().mockResolvedValue({ ok: true })

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isLoading: false }),
  useUploadFile: () => ({ mutateAsync: uploadMutateAsync }),
  useUpdateFile: () => ({ mutate: updateMutate }),
  useDeleteFile: () => ({ mutateAsync: deleteMutateAsync }),
  formatFileSize: (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  },
}))

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'f1',
    name: '要件定義書.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024 * 500,
    origin: 'internal',
    clientVisible: false,
    uploadedBy: 'u1',
    uploaderName: '田中太郎',
    createdAt: '2026-07-01T00:00:00',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFiles.length = 0
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

function renderPage() {
  return render(<FilesPageClient orgId="org-1" spaceId="space-1" />)
}

describe('FilesPageClient 一覧表示', () => {
  it('ファイルの名前・サイズ・アップロード者を表示する', () => {
    mockFiles.push(makeFile())
    renderPage()

    expect(screen.getByText('要件定義書.pdf')).toBeInTheDocument()
    expect(screen.getByText('500 KB')).toBeInTheDocument()
    expect(screen.getByText('田中太郎')).toBeInTheDocument()
  })

  it('ファイルがない場合は空状態を表示する', () => {
    renderPage()
    expect(screen.getByText('ファイルはまだありません')).toBeInTheDocument()
  })
})

describe('FilesPageClient クライアント提供ファイル', () => {
  it('origin=client のファイルには「クライアント提供」バッジを表示する', () => {
    mockFiles.push(makeFile({ id: 'f2', origin: 'client', clientVisible: true }))
    renderPage()
    expect(screen.getByText('クライアント提供')).toBeInTheDocument()
  })

  it('クライアント提供ファイルの公開トグルは無効化される', () => {
    mockFiles.push(makeFile({ id: 'f2', origin: 'client', clientVisible: true }))
    renderPage()
    const toggle = screen.getByTestId('file-visibility-toggle-f2')
    expect(toggle).toBeDisabled()
  })
})

describe('FilesPageClient クライアント公開トグル', () => {
  it('トグルをクリックすると useUpdateFile が反転した値で呼ばれる', () => {
    mockFiles.push(makeFile({ id: 'f1', clientVisible: false }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-visibility-toggle-f1'))

    expect(updateMutate).toHaveBeenCalledWith({
      spaceId: 'space-1',
      fileId: 'f1',
      clientVisible: true,
    })
  })
})

describe('FilesPageClient リンクコピー', () => {
  it('「リンクをコピー」を押すとダウンロードURLをクリップボードにコピーしトーストを表示する', async () => {
    mockFiles.push(makeFile({ id: 'f1' }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-copy-link-f1'))

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        `${window.location.origin}/api/files/f1/download`
      )
    })
    expect(toastSuccess).toHaveBeenCalledWith(
      'リンクをコピーしました。Wikiに貼り付けるとファイルリンクになります'
    )
  })
})

describe('FilesPageClient 削除確認', () => {
  it('削除ボタン→確認ダイアログで確認すると useDeleteFile が呼ばれる', async () => {
    mockFiles.push(makeFile({ id: 'f1' }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-delete-f1'))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText('このファイルは完全に削除されます。この操作は取り消せません。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({ spaceId: 'space-1', fileId: 'f1' })
    })
  })

  it('確認ダイアログでキャンセルすると useDeleteFile は呼ばれない', async () => {
    mockFiles.push(makeFile({ id: 'f1' }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-delete-f1'))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(deleteMutateAsync).not.toHaveBeenCalled()
  })
})

describe('FilesPageClient アップロード', () => {
  it('50MBを超えるファイルはアップロードせずエラートーストを表示する', () => {
    renderPage()
    const input = screen.getByTestId('files-input') as HTMLInputElement
    const bigFile = new File(['x'], 'big.zip', { type: 'application/zip' })
    Object.defineProperty(bigFile, 'size', { value: 52428801 })

    fireEvent.change(input, { target: { files: [bigFile] } })

    expect(uploadMutateAsync).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })

  it('ファイルを選択すると useUploadFile が呼ばれる', async () => {
    renderPage()
    const input = screen.getByTestId('files-input') as HTMLInputElement
    const file = new File(['x'], 'small.txt', { type: 'text/plain' })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadMutateAsync).toHaveBeenCalledWith({ spaceId: 'space-1', file })
    })
  })
})
