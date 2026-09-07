import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FileTablePageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/files/[fileId]/FileTablePageClient'
import type { ProjectFile } from '@/lib/hooks/useFiles'
import type { FileTableResult } from '@/lib/hooks/useFileTable'

/**
 * ファイル→表ビューのページ。
 * - ファイル一覧のキャッシュ(useFiles)から名前を出し、中身は useFileTable で取る
 * - 開けないときは理由とダウンロードの逃げ道を出す
 */

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 36,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 36, size: 36 })),
    measureElement: () => {},
  }),
}))

const mockFiles: ProjectFile[] = []
let tableState: {
  data: FileTableResult | undefined
  isPending: boolean
  error: Error | null
  refetch: () => void
}

vi.mock('@/lib/hooks/useFiles', () => ({
  useFiles: () => ({ data: mockFiles, isPending: false }),
}))
vi.mock('@/lib/hooks/useFileTable', () => ({
  useFileTable: () => tableState,
}))

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'f1',
    name: 'ターゲット一覧.csv',
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

beforeEach(() => {
  mockFiles.length = 0
  mockFiles.push(makeFile())
  tableState = { data: undefined, isPending: true, error: null, refetch: vi.fn() }
})

function renderPage() {
  return render(<FileTablePageClient orgId="org-1" spaceId="space-1" fileId="f1" />)
}

describe('FileTablePageClient', () => {
  it('読み込み中はローディングを出す', () => {
    renderPage()
    expect(screen.getByText('読み込み中...')).toBeInTheDocument()
  })

  it('ファイル名をパンくずに出し、表を表示する', () => {
    tableState = {
      data: { table: { columns: ['会社名', '県'], rows: [['A社', '広島県']] }, encoding: 'utf-8' },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }
    renderPage()

    expect(screen.getByText('ターゲット一覧.csv')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /会社名/ })).toBeInTheDocument()
    expect(screen.getByText('A社')).toBeInTheDocument()
    // 一覧へ戻るパンくず
    expect(screen.getByRole('link', { name: 'ファイル' })).toHaveAttribute('href', '/org-1/project/space-1/files')
    // ダウンロードの導線
    expect(screen.getByRole('link', { name: /ダウンロード/ })).toHaveAttribute('href', '/api/files/f1/download')
  })

  it('Shift_JIS で読んだときはその旨を小さく出す', () => {
    tableState = {
      data: { table: { columns: ['a'], rows: [['1']] }, encoding: 'shift_jis' },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    }
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
