import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WikiFileLinkPicker } from '@/components/wiki/WikiFileLinkPicker'
import type { ProjectFile } from '@/lib/hooks/useFiles'

const SPACE_ID = 'space-1'

const mockUseFiles = vi.fn()

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: (...args: unknown[]) => mockUseFiles(...args),
}))

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'file-1',
    name: '要件定義.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2_400_000,
    origin: 'internal',
    clientVisible: true,
    uploadedBy: 'user-1',
    uploaderName: 'Yuta',
    createdAt: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('WikiFileLinkPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a loading state while files are being fetched', () => {
    mockUseFiles.mockReturnValue({ data: undefined, isLoading: true })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('renders an empty state when there are no files', () => {
    mockUseFiles.mockReturnValue({ data: [], isLoading: false })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(
      screen.getByText('ファイルはまだありません。プロジェクトのファイルページからアップロードできます')
    ).toBeInTheDocument()
  })

  it('lists files with their formatted size', () => {
    mockUseFiles.mockReturnValue({
      data: [makeFile({ name: '議事録.docx', sizeBytes: 1024 })],
      isLoading: false,
    })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(screen.getByText('議事録.docx')).toBeInTheDocument()
    expect(screen.getByText('1 KB')).toBeInTheDocument()
  })

  it('shows a "社内のみ" badge for files that are not client-visible', () => {
    mockUseFiles.mockReturnValue({
      data: [makeFile({ name: '内部メモ.txt', clientVisible: false })],
      isLoading: false,
    })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(screen.getByText('社内のみ')).toBeInTheDocument()
  })

  it('does not show the badge for client-visible files', () => {
    mockUseFiles.mockReturnValue({
      data: [makeFile({ name: '公開資料.pdf', clientVisible: true })],
      isLoading: false,
    })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(screen.queryByText('社内のみ')).not.toBeInTheDocument()
  })

  it('calls onSelect with the clicked file', () => {
    const onSelect = vi.fn()
    const file = makeFile({ name: '仕様書.pdf' })
    mockUseFiles.mockReturnValue({ data: [file], isLoading: false })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('仕様書.pdf'))
    expect(onSelect).toHaveBeenCalledWith(file)
  })

  it('shows a persistent warning after selecting an internal-only file', () => {
    const file = makeFile({ name: '内部メモ.txt', clientVisible: false })
    mockUseFiles.mockReturnValue({ data: [file], isLoading: false })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(
      screen.queryByText('社内のみのファイルはクライアントには表示されません(リンクを開けません)')
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('内部メモ.txt'))
    expect(
      screen.getByText('社内のみのファイルはクライアントには表示されません(リンクを開けません)')
    ).toBeInTheDocument()
  })

  it('clears the warning after selecting a client-visible file', () => {
    const internalFile = makeFile({ id: 'f1', name: '内部メモ.txt', clientVisible: false })
    const publicFile = makeFile({ id: 'f2', name: '公開資料.pdf', clientVisible: true })
    mockUseFiles.mockReturnValue({ data: [internalFile, publicFile], isLoading: false })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('内部メモ.txt'))
    expect(
      screen.getByText('社内のみのファイルはクライアントには表示されません(リンクを開けません)')
    ).toBeInTheDocument()
    fireEvent.click(screen.getByText('公開資料.pdf'))
    expect(
      screen.queryByText('社内のみのファイルはクライアントには表示されません(リンクを開けません)')
    ).not.toBeInTheDocument()
  })

  it('passes spaceId through to useFiles', () => {
    mockUseFiles.mockReturnValue({ data: [], isLoading: false })
    render(<WikiFileLinkPicker spaceId={SPACE_ID} onSelect={vi.fn()} />)
    expect(mockUseFiles).toHaveBeenCalledWith(SPACE_ID)
  })
})
