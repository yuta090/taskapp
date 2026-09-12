import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MinutesEditor, TaskMarkerChip } from '@/components/meeting/MinutesEditor'
import type { AppLink } from '@/lib/navigation/appLinks'

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
describe('MinutesEditor のリンク差し込み', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedOnSelect = undefined
  })

  it('編集できるときは「リンクを挿入」を出す（絵文字は使わない）', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByText('リンクを挿入')).toBeInTheDocument()
  })

  it('読み取り専用なら出さない', () => {
    render(<MinutesEditor minutesMd="" editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByText('リンクを挿入')).not.toBeInTheDocument()
  })

  it('ボタンを押すとパネルが開き、もう一度押すと閉じる', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('リンクを挿入'))
    // ピッカーは押したときに読み込む（next/dynamic）ので、出てくるのを待つ
    expect(await screen.findByTestId('app-link-picker')).toBeInTheDocument()

    fireEvent.click(screen.getByText('リンクを挿入'))
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
  })

  it('選んだリンクをカーソル位置に入れて、パネルを閉じる', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('リンクを挿入'))
    await screen.findByTestId('app-link-picker')

    act(() =>
      capturedOnSelect?.({ href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=page-1`, label: '議事録テンプレ' })
    )

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=page-1`, content: '議事録テンプレ' },
    ])
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
  })

  it('ファイルを選んだときはパネルを開いたままにする（社内のみの注意を読めるように）', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('リンクを挿入'))
    await screen.findByTestId('app-link-picker')

    act(() => capturedOnSelect?.({ href: '/api/files/file-42/download', label: '仕様書.pdf' }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-42/download', content: '仕様書.pdf' },
    ])
    expect(await screen.findByTestId('app-link-picker')).toBeInTheDocument()
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
      'insert_app_link',
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
