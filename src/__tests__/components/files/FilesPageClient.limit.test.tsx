import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilesPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/FilesPageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 一覧は新しい順に FILES_LIST_LIMIT 件までしか取らない。
 * 黙って切り捨てると「探しているファイルが無い」のか「隠れている」のか分からないので画面に出す。
 * 500件をレンダリングすると重いので、この試験だけ上限を2件に差し替える。
 */
vi.mock('@/lib/files/limits', () => ({ FILES_LIST_LIMIT: 2 }))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockFiles: ProjectFile[] = []
vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isLoading: false }),
  useUploadFile: () => ({ mutateAsync: vi.fn() }),
  useUpdateFile: () => ({ mutate: vi.fn() }),
  useDeleteFile: () => ({ mutateAsync: vi.fn() }),
  formatFileSize: () => '1 KB',
}))

function makeFile(id: string): ProjectFile {
  return {
    id,
    name: `${id}.pdf`,
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

beforeEach(() => {
  mockFiles.length = 0
})

describe('FilesPageClient 取得件数の上限', () => {
  it('上限まで返ってきたら「新しい順に◯件まで」と伝える', () => {
    mockFiles.push(makeFile('f1'), makeFile('f2'))
    render(<FilesPageClient orgId="org-1" spaceId="space-1" />)

    expect(screen.getByTestId('files-limit-notice')).toHaveTextContent('新しい順に2件まで表示しています')
  })

  it('上限に達していなければ何も出さない', () => {
    mockFiles.push(makeFile('f1'))
    render(<FilesPageClient orgId="org-1" spaceId="space-1" />)

    expect(screen.queryByTestId('files-limit-notice')).not.toBeInTheDocument()
  })
})
