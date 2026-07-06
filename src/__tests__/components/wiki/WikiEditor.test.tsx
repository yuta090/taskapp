import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WikiEditor } from '@/components/wiki/WikiEditor'
import type { ProjectFile } from '@/lib/hooks/useFiles'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

const mockInsertInlineContent = vi.fn()
const mockInsertBlocks = vi.fn()
const mockGetTextCursorPosition = vi.fn(() => ({ block: { id: 'block-1' } }))

// BlockNote mounts a real ProseMirror editor which is heavy/unstable in jsdom.
// Mock the hook and view so this test focuses on the toolbar wiring instead.
vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: () => ({
      document: [],
      insertInlineContent: mockInsertInlineContent,
      insertBlocks: mockInsertBlocks,
      getTextCursorPosition: mockGetTextCursorPosition,
    }),
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: () => <div data-testid="blocknote-view" />,
}))

let capturedOnSelect: ((file: ProjectFile) => void) | undefined

vi.mock('@/components/wiki/WikiFileLinkPicker', () => ({
  WikiFileLinkPicker: ({ onSelect }: { onSelect: (file: ProjectFile) => void }) => {
    capturedOnSelect = onSelect
    return <div data-testid="wiki-file-link-picker" />
  },
}))

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'file-1',
    name: '要件定義.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    origin: 'internal',
    clientVisible: true,
    uploadedBy: 'user-1',
    uploaderName: 'Yuta',
    createdAt: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('WikiEditor file link insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnSelect = undefined
  })

  it('shows the file link button when editable', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByText('📎 ファイルリンクを挿入')).toBeInTheDocument()
  })

  it('hides the file link button when not editable', () => {
    render(<WikiEditor editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByText('📎 ファイルリンクを挿入')).not.toBeInTheDocument()
  })

  it('toggles the file picker panel when clicking the button', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('wiki-file-link-picker')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('📎 ファイルリンクを挿入'))
    expect(screen.getByTestId('wiki-file-link-picker')).toBeInTheDocument()

    fireEvent.click(screen.getByText('📎 ファイルリンクを挿入'))
    expect(screen.queryByTestId('wiki-file-link-picker')).not.toBeInTheDocument()
  })

  it('inserts a link block for the selected file and closes the panel', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('📎 ファイルリンクを挿入'))
    expect(screen.getByTestId('wiki-file-link-picker')).toBeInTheDocument()

    const file = makeFile({ id: 'file-42', name: '仕様書.pdf', clientVisible: true })
    act(() => capturedOnSelect?.(file))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-42/download', content: '仕様書.pdf' },
    ])
    expect(screen.queryByTestId('wiki-file-link-picker')).not.toBeInTheDocument()
  })

  it('keeps the panel open after selecting an internal-only file', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('📎 ファイルリンクを挿入'))

    const internalFile = makeFile({ id: 'file-99', name: '内部メモ.txt', clientVisible: false })
    act(() => capturedOnSelect?.(internalFile))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-99/download', content: '内部メモ.txt' },
    ])
    expect(screen.getByTestId('wiki-file-link-picker')).toBeInTheDocument()
  })
})
