import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalFilesClient } from '@/app/portal/files/PortalFilesClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/portal/files',
}))

// PortalLeftNav (rendered by PortalShell) calls useCurrentUser() unconditionally
// — mock it directly rather than reconstructing the full supabase auth chain.
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const uploadMutateAsync = vi.fn().mockResolvedValue({ ok: true })
const deleteMutateAsync = vi.fn().mockResolvedValue({ ok: true })

vi.mock('@/lib/hooks/useFiles', () => ({
  useUploadFile: () => ({ mutateAsync: uploadMutateAsync, isPending: false }),
  useDeleteFile: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }
const CURRENT_USER_ID = 'client-user-1'
const OTHER_USER_ID = 'internal-user-1'

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'file-1',
    name: '議事録.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024 * 500,
    origin: 'internal',
    clientVisible: true,
    uploadedBy: OTHER_USER_ID,
    uploaderName: '内部担当者',
    createdAt: '2026-07-01T00:00:00+09:00',
    ...overrides,
  }
}

function renderWithProviders(files: ProjectFile[], currentUserId = CURRENT_USER_ID) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalFilesClient
        currentProject={project}
        projects={[project]}
        files={files}
        currentUserId={currentUserId}
      />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PortalFilesClient 一覧表示', () => {
  it('ファイル名・サイズ・ダウンロードリンクを表示する', () => {
    renderWithProviders([makeFile()])

    expect(screen.getByText('議事録.pdf')).toBeInTheDocument()
    expect(screen.getByText(/500 KB/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /議事録\.pdf/ })
    expect(link).toHaveAttribute('href', '/api/files/file-1/download')
  })

  it('ファイルが0件のとき空状態を表示する', () => {
    renderWithProviders([])

    expect(screen.getByText('ファイルはまだありません')).toBeInTheDocument()
    expect(
      screen.getByText('チームからの共有ファイルや、あなたがアップロードした資料がここに表示されます')
    ).toBeInTheDocument()
  })
})

describe('PortalFilesClient 自分のアップロード', () => {
  it('自分がアップロードしたファイルにはバッジと削除ボタンを表示する', () => {
    renderWithProviders([makeFile({ id: 'file-own', uploadedBy: CURRENT_USER_ID })])

    expect(screen.getByText('あなたがアップロード')).toBeInTheDocument()
    expect(screen.getByTestId('file-delete-file-own')).toBeInTheDocument()
  })

  it('他人がアップロードしたファイルには削除ボタンもバッジも表示しない', () => {
    renderWithProviders([makeFile({ id: 'file-other', uploadedBy: OTHER_USER_ID })])

    expect(screen.queryByText('あなたがアップロード')).not.toBeInTheDocument()
    expect(screen.queryByTestId('file-delete-file-other')).not.toBeInTheDocument()
  })
})

describe('PortalFilesClient 削除確認', () => {
  it('削除ボタン→確認ダイアログで確認すると useDeleteFile が呼ばれ画面を更新する', async () => {
    renderWithProviders([makeFile({ id: 'file-own', uploadedBy: CURRENT_USER_ID })])

    fireEvent.click(screen.getByTestId('file-delete-file-own'))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => {
      expect(deleteMutateAsync).toHaveBeenCalledWith({ spaceId: 'space-1', fileId: 'file-own' })
    })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('確認ダイアログでキャンセルすると useDeleteFile は呼ばれない', async () => {
    renderWithProviders([makeFile({ id: 'file-own', uploadedBy: CURRENT_USER_ID })])

    fireEvent.click(screen.getByTestId('file-delete-file-own'))
    expect(await screen.findByRole('alertdialog')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(deleteMutateAsync).not.toHaveBeenCalled()
  })
})

describe('PortalFilesClient アップロード', () => {
  it('ファイルを選択すると useUploadFile が呼ばれ成功トーストと画面更新が起きる', async () => {
    renderWithProviders([])
    const input = screen.getByTestId('portal-files-input') as HTMLInputElement
    const file = new File(['x'], 'proposal.pdf', { type: 'application/pdf' })

    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(uploadMutateAsync).toHaveBeenCalledWith({ spaceId: 'space-1', file })
    })
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('ファイルをアップロードしました。チームに通知されます')
    })
    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled()
    })
  })

  it('50MBを超えるファイルはアップロードせずエラートーストを表示する', () => {
    renderWithProviders([])
    const input = screen.getByTestId('portal-files-input') as HTMLInputElement
    const bigFile = new File(['x'], 'big.zip', { type: 'application/zip' })
    Object.defineProperty(bigFile, 'size', { value: 52428801 })

    fireEvent.change(input, { target: { files: [bigFile] } })

    expect(uploadMutateAsync).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalled()
  })
})
