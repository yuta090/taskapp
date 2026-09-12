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

// 「/」メニューの既定の項目（本物は editor の辞書と schema から作られる）
const DEFAULT_SLASH_ITEMS = [
  { key: 'heading', title: '見出し１', aliases: ['h1'], group: '見出し', onItemClick: () => {} },
  { key: 'bullet_list', title: '箇条書き', aliases: ['ul'], group: '基本ブロック', onItemClick: () => {} },
  { key: 'image', title: '画像', aliases: ['image'], group: 'メディア', onItemClick: () => {} },
  { key: 'video', title: 'ビデオ', aliases: ['video'], group: 'メディア', onItemClick: () => {} },
  { key: 'audio', title: 'オーディオ', aliases: ['audio'], group: 'メディア', onItemClick: () => {} },
  { key: 'file', title: 'ファイル', aliases: ['file'], group: 'メディア', onItemClick: () => {} },
]

let capturedEditorOptions:
  | { dictionary?: { placeholders: Record<string, string | undefined>; slash_menu: Record<string, { title: string }> } }
  | undefined
let capturedSlashMenuProps:
  | { triggerCharacter: string; getItems?: (query: string) => Promise<Array<{ key: string }>> }
  | undefined

// BlockNote mounts a real ProseMirror editor which is heavy/unstable in jsdom.
// Mock the hook and view so this test focuses on the toolbar wiring instead.
vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: (options: typeof capturedEditorOptions) => {
      capturedEditorOptions = options
      return {
        document: [],
        insertInlineContent: mockInsertInlineContent,
        insertBlocks: mockInsertBlocks,
        getTextCursorPosition: mockGetTextCursorPosition,
      }
    },
    getDefaultReactSlashMenuItems: () => DEFAULT_SLASH_ITEMS,
    SuggestionMenuController: (props: NonNullable<typeof capturedSlashMenuProps>) => {
      capturedSlashMenuProps = props
      return null
    },
  }
})

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="blocknote-view">{children}</div>
  ),
}))

let capturedOnSelect: ((file: ProjectFile) => void) | undefined

vi.mock('@/components/wiki/WikiFileLinkPicker', () => ({
  WikiFileLinkPicker: ({ onSelect }: { onSelect: (file: ProjectFile) => void }) => {
    capturedOnSelect = onSelect
    return <div data-testid="wiki-file-link-picker" />
  },
}))

let capturedWikiPageLinkProps:
  | { onSelect: (page: { id: string; title: string }) => void; excludePageId?: string }
  | undefined

vi.mock('@/components/wiki/WikiPageLinkInsertPicker', () => ({
  WikiPageLinkInsertPicker: (props: NonNullable<typeof capturedWikiPageLinkProps>) => {
    capturedWikiPageLinkProps = props
    return <div data-testid="wiki-page-link-insert-picker" />
  },
}))

function makeFile(overrides: Partial<ProjectFile> = {}): ProjectFile {
  return {
    id: 'file-1',
    name: '要件定義.pdf',
    description: null,
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
    capturedWikiPageLinkProps = undefined
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

describe('WikiEditor slash menu and Japanese texts', () => {
  beforeEach(() => {
    capturedEditorOptions = undefined
    capturedSlashMenuProps = undefined
  })

  // 行の左の「＋」も、BlockNote の中でこの「/」メニューを開く（AddBlockButton → openSuggestionMenu('/')）
  it('opens a menu when typing "/" (the "+" beside a line opens the same menu)', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(capturedSlashMenuProps?.triggerCharacter).toBe('/')
  })

  it('lists the default items except video and audio, which cannot play on this page', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('')
    expect(items.map(item => item.key)).toEqual(['heading', 'bullet_list', 'image', 'file'])
  })

  it('narrows the items by what is typed after "/"', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('見出し')
    expect(items.map(item => item.key)).toEqual(['heading'])
  })

  it('uses Japanese texts, including the hint on an empty line', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(capturedEditorOptions?.dictionary?.placeholders.default).toBe('文字を入力、または「/」でメニューを開く')
    expect(capturedEditorOptions?.dictionary?.slash_menu.heading.title).toBe('見出し１')
  })
})

describe('WikiEditor Wiki page link insertion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnSelect = undefined
    capturedWikiPageLinkProps = undefined
  })

  it('shows the wiki page link button when editable and both orgId/spaceId are given', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByText('🔗 Wikiページへのリンク')).toBeInTheDocument()
  })

  it('hides the wiki page link button when not editable', () => {
    render(<WikiEditor editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByText('🔗 Wikiページへのリンク')).not.toBeInTheDocument()
  })

  it('hides the wiki page link button when orgId or spaceId is missing (read-only portal view)', () => {
    render(<WikiEditor editable />)
    expect(screen.queryByText('🔗 Wikiページへのリンク')).not.toBeInTheDocument()
  })

  it('toggles the wiki page link picker panel when clicking the button', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('wiki-page-link-insert-picker')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('🔗 Wikiページへのリンク'))
    expect(screen.getByTestId('wiki-page-link-insert-picker')).toBeInTheDocument()

    fireEvent.click(screen.getByText('🔗 Wikiページへのリンク'))
    expect(screen.queryByTestId('wiki-page-link-insert-picker')).not.toBeInTheDocument()
  })

  it('inserts a link for the selected page and closes the panel', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('🔗 Wikiページへのリンク'))

    act(() => capturedWikiPageLinkProps?.onSelect({ id: 'page-1', title: '仕様メモ' }))

    expect(mockInsertInlineContent).toHaveBeenCalledTimes(1)
    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=page-1`, content: '仕様メモ' },
    ])
    expect(screen.queryByTestId('wiki-page-link-insert-picker')).not.toBeInTheDocument()
  })

  it('passes currentPageId through as excludePageId so the open page is not offered as a link target', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} currentPageId="page-self" />)
    fireEvent.click(screen.getByText('🔗 Wikiページへのリンク'))
    expect(capturedWikiPageLinkProps?.excludePageId).toBe('page-self')
  })

  it('closes the file link picker when opening the wiki page link picker, and vice versa', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)

    fireEvent.click(screen.getByText('📎 ファイルリンクを挿入'))
    expect(screen.getByTestId('wiki-file-link-picker')).toBeInTheDocument()

    fireEvent.click(screen.getByText('🔗 Wikiページへのリンク'))
    expect(screen.getByTestId('wiki-page-link-insert-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-file-link-picker')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('📎 ファイルリンクを挿入'))
    expect(screen.getByTestId('wiki-file-link-picker')).toBeInTheDocument()
    expect(screen.queryByTestId('wiki-page-link-insert-picker')).not.toBeInTheDocument()
  })
})
