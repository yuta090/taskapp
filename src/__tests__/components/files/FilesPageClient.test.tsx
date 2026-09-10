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

// お知らせベルは Supabase/組織コンテキストを引くので、取得層だけ差し替えて
// 「ヘッダーのどこに置かれているか」だけを検証する。
vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

const mockFiles: ProjectFile[] = []
const uploadMutateAsync = vi.fn().mockResolvedValue({ ok: true })
const updateMutate = vi.fn()
const deleteMutateAsync = vi.fn().mockResolvedValue({ ok: true })

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isLoading: false, hasMore: false }),
  // 上限内のスペースではサーバー検索は使わない(enabled=false)
  useFileSearch: () => ({ data: undefined, hasMore: false, isFetching: false, isError: false }),
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
    description: null,
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

describe('FilesPageClient 表で見る', () => {
  it('CSV ファイルには「表で見る」リンクが付き、表ビューのページへ飛ぶ', () => {
    mockFiles.push(makeFile({ id: 'f-csv', name: 'ターゲット一覧.csv', mimeType: 'text/csv' }))
    renderPage()

    const link = screen.getByTestId('file-open-table-f-csv')
    expect(link).toHaveAttribute('href', '/org-1/project/space-1/files/f-csv')
    // ファイル名そのものも同じページへのリンクにする(押しやすさ)
    expect(screen.getByRole('link', { name: 'ターゲット一覧.csv' })).toHaveAttribute(
      'href',
      '/org-1/project/space-1/files/f-csv'
    )
  })

  it('PDF など表でないファイルには「表で見る」リンクを出さない', () => {
    mockFiles.push(makeFile({ id: 'f-pdf', name: '要件定義書.pdf', mimeType: 'application/pdf' }))
    renderPage()

    expect(screen.queryByTestId('file-open-table-f-pdf')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '要件定義書.pdf' })).not.toBeInTheDocument()
  })
})

describe('FilesPageClient 説明文', () => {
  it('説明文があれば名前の下に表示する', () => {
    mockFiles.push(makeFile({ id: 'f1', description: '4月に client からもらった元データ' }))
    renderPage()

    expect(screen.getByTestId('file-description-f1')).toHaveTextContent('4月に client からもらった元データ')
  })

  it('説明文がなければ「説明を追加」を出す', () => {
    mockFiles.push(makeFile({ id: 'f1', description: null }))
    renderPage()

    expect(screen.getByTestId('file-description-edit-f1')).toHaveTextContent('説明を追加')
  })

  it('説明を書いて Enter を押すと useUpdateFile が description 付きで呼ばれる', () => {
    mockFiles.push(makeFile({ id: 'f1', description: null }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-description-edit-f1'))
    const input = screen.getByTestId('file-description-input-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '毎月更新する元データ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateMutate).toHaveBeenCalledWith({
      spaceId: 'space-1',
      fileId: 'f1',
      description: '毎月更新する元データ',
    })
  })

  it('Esc を押すと編集をやめて保存しない', () => {
    mockFiles.push(makeFile({ id: 'f1', description: 'もとの説明' }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-description-f1'))
    const input = screen.getByTestId('file-description-input-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '書きかけ' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(updateMutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('file-description-f1')).toHaveTextContent('もとの説明')
  })

  it('中身が変わっていなければ保存しない', () => {
    mockFiles.push(makeFile({ id: 'f1', description: 'もとの説明' }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-description-f1'))
    fireEvent.keyDown(screen.getByTestId('file-description-input-f1'), { key: 'Enter' })

    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('空にして保存すると説明を消す(null)', () => {
    mockFiles.push(makeFile({ id: 'f1', description: 'もとの説明' }))
    renderPage()

    fireEvent.click(screen.getByTestId('file-description-f1'))
    const input = screen.getByTestId('file-description-input-f1') as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(updateMutate).toHaveBeenCalledWith({ spaceId: 'space-1', fileId: 'f1', description: null })
  })
})

describe('FilesPageClient 絞り込み', () => {
  it('検索でファイル名を絞り込む', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '要件定義書.pdf' }))
    mockFiles.push(makeFile({ id: 'f2', name: '売上一覧.csv', mimeType: 'text/csv' }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '売上' } })

    expect(screen.queryByText('要件定義書.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('売上一覧.csv')).toBeInTheDocument()
  })

  it('検索は説明文にもあたる', () => {
    mockFiles.push(makeFile({ id: 'f1', name: 'a.pdf', description: '請求まわりの資料' }))
    mockFiles.push(makeFile({ id: 'f2', name: 'b.pdf', description: null }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '請求' } })

    expect(screen.getByText('a.pdf')).toBeInTheDocument()
    expect(screen.queryByText('b.pdf')).not.toBeInTheDocument()
  })

  it('種類で絞り込む', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '要件定義書.pdf' }))
    mockFiles.push(makeFile({ id: 'f2', name: '売上一覧.csv', mimeType: 'text/csv' }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-filter-kind'), { target: { value: 'table' } })

    expect(screen.queryByText('要件定義書.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('売上一覧.csv')).toBeInTheDocument()
  })

  it('公開状態で絞り込む', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '社内メモ.pdf', clientVisible: false }))
    mockFiles.push(makeFile({ id: 'f2', name: '共有資料.pdf', clientVisible: true }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-filter-visibility'), { target: { value: 'visible' } })

    expect(screen.queryByText('社内メモ.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('共有資料.pdf')).toBeInTheDocument()
  })

  it('提供元で絞り込む', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '社内資料.pdf', origin: 'internal' }))
    mockFiles.push(makeFile({ id: 'f2', name: '先方資料.pdf', origin: 'client', clientVisible: true }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-filter-origin'), { target: { value: 'client' } })

    expect(screen.queryByText('社内資料.pdf')).not.toBeInTheDocument()
    expect(screen.getByText('先方資料.pdf')).toBeInTheDocument()
  })

  it('条件に合うものがなければ、空だと言い切らず条件のせいだと伝える', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '要件定義書.pdf' }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: 'まったく無い名前' } })

    expect(screen.getByText('条件に合うファイルがありません')).toBeInTheDocument()
    expect(screen.queryByText('ファイルはまだありません')).not.toBeInTheDocument()
  })

  it('「条件をクリア」で全件に戻る', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '要件定義書.pdf' }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: 'まったく無い名前' } })
    fireEvent.click(screen.getByTestId('files-filter-clear'))

    expect(screen.getByText('要件定義書.pdf')).toBeInTheDocument()
  })

  it('絞り込み中は「N件 / 全M件」を表示する', () => {
    mockFiles.push(makeFile({ id: 'f1', name: '要件定義書.pdf' }))
    mockFiles.push(makeFile({ id: 'f2', name: '売上一覧.csv', mimeType: 'text/csv' }))
    renderPage()

    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '売上' } })

    expect(screen.getByTestId('files-count')).toHaveTextContent('1件 / 全2件')
  })

  it('ファイルが1つもないときは絞り込みバーを出さない', () => {
    renderPage()
    expect(screen.queryByTestId('files-search')).not.toBeInTheDocument()
  })
})

describe('FilesPageClient — お知らせベルの置き場所', () => {
  it('ヘッダーの中にあり、ベル行を消す目印が付いている', () => {
    renderPage()
    const bell = screen.getByRole('button', { name: 'お知らせ' })
    expect(bell.closest('header')).not.toBeNull()
    expect(bell.closest('[data-header-bell]')).not.toBeNull()
  })
})
