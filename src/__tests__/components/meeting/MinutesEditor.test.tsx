import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MinutesEditor, TaskMarkerChip } from '@/components/meeting/MinutesEditor'
import type { ProjectFile } from '@/lib/hooks/useFiles'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockInsertInlineContent = vi.fn()
const mockDocument: unknown[] = [{ type: 'paragraph', content: [] }]
const mockUseCreateBlockNote = vi.fn((_opts: unknown) => ({
  document: mockDocument,
  insertInlineContent: mockInsertInlineContent,
}))

/**
 * 「/」メニューに出る既定の項目。BlockNote は editor のスキーマに無いブロックの項目を
 * そもそも作らないので、ここでは議事録のスキーマに有るもの＋無いもの（divider・image）を
 * 混ぜて、議事録側が Markdown で往復できるものだけに絞れているかを見る
 */
const DEFAULT_SLASH_ITEMS = [
  { key: 'heading', title: '見出し１', aliases: ['h1'], group: '見出し', onItemClick: () => {} },
  { key: 'bullet_list', title: '箇条書き', aliases: ['ul'], group: '基本ブロック', onItemClick: () => {} },
  { key: 'check_list', title: 'チェックリスト', aliases: ['todo'], group: '基本ブロック', onItemClick: () => {} },
  { key: 'table', title: '表', aliases: ['table'], group: '高度なブロック', onItemClick: () => {} },
  { key: 'code_block', title: 'コードブロック', aliases: ['code'], group: '基本ブロック', onItemClick: () => {} },
  { key: 'divider', title: '区切り', aliases: ['hr'], group: '基本ブロック', onItemClick: () => {} },
  { key: 'image', title: '画像', aliases: ['image'], group: 'メディア', onItemClick: () => {} },
]

let capturedSlashMenuProps:
  | { triggerCharacter: string; getItems?: (query: string) => Promise<Array<{ key: string }>> }
  | undefined

// BlockNote mounts a real ProseMirror editor which is heavy/unstable in jsdom.
// Mock the hook and view so this test focuses on the toolbar wiring instead
// (同じ理由で WikiEditor.test.tsx も同じやり方をしている)。
vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: (opts: unknown) => mockUseCreateBlockNote(opts),
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

let capturedFilePickerOnSelect: ((file: ProjectFile) => void) | undefined
vi.mock('@/components/wiki/WikiFileLinkPicker', () => ({
  WikiFileLinkPicker: ({ onSelect }: { onSelect: (file: ProjectFile) => void }) => {
    capturedFilePickerOnSelect = onSelect
    return <div data-testid="wiki-file-link-picker" />
  },
}))

let capturedWikiPickerOnSelect: ((page: { id: string; title: string }) => void) | undefined
vi.mock('@/components/wiki/WikiPageLinkInsertPicker', () => ({
  WikiPageLinkInsertPicker: ({ onSelect }: { onSelect: (page: { id: string; title: string }) => void }) => {
    capturedWikiPickerOnSelect = onSelect
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

describe('MinutesEditor 差し込みツールバー', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedFilePickerOnSelect = undefined
    capturedWikiPickerOnSelect = undefined
  })

  it('編集可能なら差し込みボタンを両方出す（絵文字は使わない）', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByText('ファイルへのリンク')).toBeInTheDocument()
    expect(screen.getByText('Wikiページへのリンク')).toBeInTheDocument()
  })

  it('読み取り専用なら差し込みボタンを出さない', () => {
    render(<MinutesEditor minutesMd="" editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByText('ファイルへのリンク')).not.toBeInTheDocument()
    expect(screen.queryByText('Wikiページへのリンク')).not.toBeInTheDocument()
  })

  it('ファイルを選ぶとリンクを挿入する', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('ファイルへのリンク'))
    expect(screen.getByTestId('wiki-file-link-picker')).toBeInTheDocument()

    const file = makeFile({ id: 'file-42', name: '仕様書.pdf' })
    act(() => capturedFilePickerOnSelect?.(file))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-42/download', content: '仕様書.pdf' },
    ])
  })

  it('Wikiページを選ぶとリンクを挿入しパネルを閉じる', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('Wikiページへのリンク'))
    expect(screen.getByTestId('wiki-page-link-insert-picker')).toBeInTheDocument()

    act(() => capturedWikiPickerOnSelect?.({ id: 'page-1', title: '議事録テンプレ' }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      {
        type: 'link',
        href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=page-1`,
        content: '議事録テンプレ',
      },
    ])
    expect(screen.queryByTestId('wiki-page-link-insert-picker')).not.toBeInTheDocument()
  })
})

const VALID_TASK_ID = '11111111-1111-1111-1111-111111111111'

describe('TaskMarkerChip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('taskId が UUID の形なら「タスク作成済み」を表示し、押すとタスク詳細へ移動する', () => {
    render(<TaskMarkerChip taskId={VALID_TASK_ID} orgId={ORG_ID} spaceId={SPACE_ID} />)
    const chip = screen.getByTestId('minutes-task-marker-chip')
    expect(chip).toHaveTextContent('タスク作成済み')

    fireEvent.click(chip)
    expect(mockPush).toHaveBeenCalledWith(`/${ORG_ID}/project/${SPACE_ID}?task=${VALID_TASK_ID}`)
  })

  it('編集できない（content:none）ので contentEditable=false を持つ', () => {
    render(<TaskMarkerChip taskId={VALID_TASK_ID} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByTestId('minutes-task-marker-chip')).toHaveAttribute('contenteditable', 'false')
  })

  it('taskId が UUID の形でなければボタン化しない（クリックしても移動しない）', () => {
    render(<TaskMarkerChip taskId="not-a-uuid" orgId={ORG_ID} spaceId={SPACE_ID} />)
    const chip = screen.getByTestId('minutes-task-marker-chip')
    expect(chip).toHaveTextContent('タスク作成済み')
    expect(chip).not.toHaveAttribute('role', 'button')

    fireEvent.click(chip)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('MinutesEditor 日本語の案内・E2E目印', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('一番外側に minutes-editor の目印を持つ', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByTestId('minutes-editor')).toBeInTheDocument()
  })

  it('BlockNote へ日本語辞書を渡し、空の文書の案内は文書ビューに任せる', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)

    const opts = mockUseCreateBlockNote.mock.calls.at(-1)?.[0] as {
      dictionary?: { placeholders?: Record<string, string> }
    }
    // 「ここに議事録を書きます」は文書ビュー側の案内文が1つ出すので、エディタの薄い文字
    // (プレースホルダー)は空にして2重表示にしない
    expect(opts?.dictionary?.placeholders?.emptyDocument).toBe('')
    // フォーカスした空行では「/」が使えると伝える（Wiki と同じ文言）
    expect(opts?.dictionary?.placeholders?.default).toBe('文字を入力、または「/」でメニューを開く')
  })
})

/**
 * 議事録は Markdown が正本なので、往復できないブロック（区切り線・画像など）を
 * 入れられてはいけない。スキーマで既に絞っているが、メニュー側でも同じ線を引く。
 */
describe('MinutesEditor の「/」メニュー', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedSlashMenuProps = undefined
  })

  // 行の左の「＋」も、BlockNote の中でこの「/」メニューを開く（AddBlockButton → openSuggestionMenu('/')）
  it('「/」でメニューが開く（行の左の「＋」も同じメニューを開く）', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(capturedSlashMenuProps?.triggerCharacter).toBe('/')
  })

  it('Markdown で往復できるものだけ出す（区切り線・画像は出さない）', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('')
    expect(items.map((item) => item.key)).toEqual([
      'heading',
      'bullet_list',
      'check_list',
      'table',
      'code_block',
    ])
  })

  it('「/」のあとに打った文字で絞り込む', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('見出し')
    expect(items.map((item) => item.key)).toEqual(['heading'])
  })

  it('読み取り専用のときはメニューを出さない', () => {
    render(<MinutesEditor minutesMd="" editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(capturedSlashMenuProps).toBeUndefined()
  })
})
