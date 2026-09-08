import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileRow } from '@/components/files/FileRow'
import type { ProjectFile } from '@/lib/hooks/useFiles'

/**
 * 一覧の1行。検索欄に1文字打つたびに全行が作り直されないよう memo 化してある。
 * そのため親から渡すハンドラは「id を受け取る安定参照」でなければならない。
 */

vi.mock('@/lib/hooks/useFiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useFiles')>()
  return { ...actual, formatFileSize: (b: number) => `${b} B` }
})

const handlers = {
  onToggleVisible: vi.fn(),
  onCopyLink: vi.fn(),
  onDelete: vi.fn(),
  onStartEditDescription: vi.fn(),
  onCommitDescription: vi.fn(),
  onCancelEditDescription: vi.fn(),
}

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'f1',
    name: '要件定義書.pdf',
    description: null,
    mimeType: 'application/pdf',
    sizeBytes: 512,
    origin: 'internal',
    clientVisible: false,
    uploadedBy: 'u1',
    uploaderName: '田中太郎',
    createdAt: '2026-07-01T00:00:00',
    ...overrides,
  }
}

function renderRow(file = makeFile(), isEditing = false) {
  return render(
    <FileRow file={file} basePath="/org-1/project/space-1" isEditing={isEditing} {...handlers} />
  )
}

beforeEach(() => vi.clearAllMocks())

describe('FileRow', () => {
  it('名前・サイズ・アップロード者・日付を出す', () => {
    renderRow()
    expect(screen.getByText('要件定義書.pdf')).toBeInTheDocument()
    expect(screen.getByText('512 B')).toBeInTheDocument()
    expect(screen.getByText('田中太郎')).toBeInTheDocument()
    expect(screen.getByText('7月1日')).toBeInTheDocument()
  })

  it('公開トグルは id と「次にどうなるか」を親に渡す', () => {
    renderRow(makeFile({ clientVisible: false }))
    fireEvent.click(screen.getByTestId('file-visibility-toggle-f1'))
    expect(handlers.onToggleVisible).toHaveBeenCalledWith('f1', true)
  })

  it('クライアント提供ファイルのトグルは押せない', () => {
    renderRow(makeFile({ origin: 'client', clientVisible: false }))
    fireEvent.click(screen.getByTestId('file-visibility-toggle-f1'))
    expect(handlers.onToggleVisible).not.toHaveBeenCalled()
  })

  it('リンクコピー・削除は id を渡す', () => {
    renderRow()
    fireEvent.click(screen.getByTestId('file-copy-link-f1'))
    expect(handlers.onCopyLink).toHaveBeenCalledWith('f1')

    fireEvent.click(screen.getByTestId('file-delete-f1'))
    expect(handlers.onDelete).toHaveBeenCalledWith('f1')
  })

  it('編集中は入力欄に差し替わり、保存すると id と値を親に渡す', () => {
    renderRow(makeFile({ description: null }), true)
    const input = screen.getByTestId('file-description-input-f1')
    fireEvent.change(input, { target: { value: '毎月の元データ' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(handlers.onCommitDescription).toHaveBeenCalledWith('f1', '毎月の元データ')
  })

  it('props が同じなら作り直さない(memo が効いている)', () => {
    const file = makeFile()
    const { rerender, container } = render(
      <FileRow file={file} basePath="/org-1/project/space-1" isEditing={false} {...handlers} />
    )
    const before = container.querySelector('[data-testid="file-row"]')

    rerender(<FileRow file={file} basePath="/org-1/project/space-1" isEditing={false} {...handlers} />)

    // DOM ノードが作り直されていない
    expect(container.querySelector('[data-testid="file-row"]')).toBe(before)
  })
})
