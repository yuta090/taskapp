import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WikiEditor } from '@/components/wiki/WikiEditor'
import type { AppLink } from '@/lib/navigation/appLinks'

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

let capturedOnSelect: ((link: AppLink) => void) | undefined

vi.mock('@/components/editor/AppLinkPicker', () => ({
  AppLinkPicker: ({ onSelect }: { onSelect: (link: AppLink) => void }) => {
    capturedOnSelect = onSelect
    return <div data-testid="app-link-picker" />
  },
}))

/**
 * リンクの差し込みは Wiki と議事録で同じ部品（AppLinkPicker）を使う。
 * ここで見るのは「ボタンでパネルが開き、選んだリンクがカーソル位置に入るか」だけ。
 * どんな候補が出るかは AppLinkPicker のテストが受け持つ。
 */
describe('WikiEditor のリンク差し込み', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnSelect = undefined
  })

  it('編集できるときは「リンクを挿入」を出す', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByText('リンクを挿入')).toBeInTheDocument()
  })

  it('読み取り専用のときは出さない', () => {
    render(<WikiEditor editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByText('リンクを挿入')).not.toBeInTheDocument()
  })

  it('相手先ポータルのようにプロジェクトが分からないときは出さない', () => {
    render(<WikiEditor editable />)
    expect(screen.queryByText('リンクを挿入')).not.toBeInTheDocument()
  })

  it('ボタンを押すとパネルが開き、もう一度押すと閉じる', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('リンクを挿入'))
    // ピッカーは押したときに読み込む（next/dynamic）ので、出てくるのを待つ
    expect(await screen.findByTestId('app-link-picker')).toBeInTheDocument()

    fireEvent.click(screen.getByText('リンクを挿入'))
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
  })

  it('選んだリンクをカーソル位置に入れて、パネルを閉じる', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('リンクを挿入'))
    await screen.findByTestId('app-link-picker')

    act(() => capturedOnSelect?.({ href: '/org-1/project/space-1?task=t1', label: 'TP-42 直す' }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/org-1/project/space-1?task=t1', content: 'TP-42 直す' },
    ])
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
  })

  it('ファイルを選んだときはパネルを開いたままにする（社内のみの注意を読めるように）', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('リンクを挿入'))
    await screen.findByTestId('app-link-picker')

    act(() => capturedOnSelect?.({ href: '/api/files/file-99/download', label: '内部メモ.txt' }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-99/download', content: '内部メモ.txt' },
    ])
    expect(await screen.findByTestId('app-link-picker')).toBeInTheDocument()
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
    // 先頭は自前の「リンクを挿入」。そのあとが BlockNote の既定（video/audio を除く）
    expect(items.map(item => item.key)).toEqual([
      'insert_app_link', 'heading', 'bullet_list', 'image', 'file',
    ])
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
