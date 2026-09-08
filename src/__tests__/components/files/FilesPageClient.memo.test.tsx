import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilesPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/FilesPageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 行(FileRow)は memo してあるが、親から渡すハンドラの参照が毎回作り直されると黙って無効になる。
 * 型チェックも eslint も FileRow 単体のテストも通ってしまい、
 * 「ファイルが多いスペースだけ検索がもたつく」という気づきにくい劣化になる。
 *
 * FileRow を記録用の部品に差し替えて、検索を1文字打った前後で
 * 「同じ行に渡された props がすべて同じ参照のままか」を見張る。時間は測らない(CIで不安定になるため)。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const receivedProps: Record<string, any[]> = {}

vi.mock('@/components/files/FileRow', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  FileRow: (props: any) => {
    ;(receivedProps[props.file.id] ||= []).push(props)
    return <div data-testid={`file-row-${props.file.id}`}>{props.file.name}</div>
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockFiles: ProjectFile[] = []

// react-query の mutate / mutateAsync は描画をまたいでも同じ関数なので、モックも同じにする
// (毎回作り直すモックにすると、本物では起きない「参照が変わった」を検出してしまう)
vi.mock('@/lib/hooks/useFiles', () => {
  const uploadMutateAsync = vi.fn()
  const updateMutate = vi.fn()
  const deleteMutateAsync = vi.fn()
  return {
    useFiles: () => ({ data: mockFiles, isLoading: false }),
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

beforeEach(() => {
  mockFiles.length = 0
  for (const key of Object.keys(receivedProps)) delete receivedProps[key]
})

describe('FilesPageClient が行に渡す props の安定性', () => {
  it('検索を1文字打っても、残る行に渡す props はすべて同じ参照のまま', () => {
    mockFiles.push(makeFile('f1', '資料A.pdf'))
    mockFiles.push(makeFile('f2', '資料B.pdf'))
    mockFiles.push(makeFile('f3', 'まったく別の名前.pdf'))
    render(<FilesPageClient orgId="org-1" spaceId="space-1" />)

    // 「資料」で絞ると f1・f2 は残り、f3 だけ消える
    fireEvent.change(screen.getByTestId('files-search'), { target: { value: '資料' } })

    expect(screen.queryByTestId('file-row-f3')).not.toBeInTheDocument()

    const renders = receivedProps['f1']
    expect(renders.length).toBeGreaterThanOrEqual(2)

    const first = renders[0]
    const latest = renders[renders.length - 1]
    for (const key of Object.keys(first)) {
      expect(latest[key], `props.${key} の参照が変わっている（memo が効かなくなる）`).toBe(first[key])
    }
  })
})
