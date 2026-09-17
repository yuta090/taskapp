import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MinutesEditor, TaskMarkerChip, TaskMetaChip } from '@/components/meeting/MinutesEditor'
import type { AppLinkSelection } from '@/components/editor/AppLinkPicker'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const mockInsertInlineContent = vi.fn()
const mockEditorFocus = vi.fn()
const mockDocument: unknown[] = [{ type: 'paragraph', content: [] }]
/**
 * 本物の `useCreateBlockNote` は **マウント中ずっと同じ editor を返す**
 * （中身は `useMemo(..., [])`）。毎回別のものを返すモックにすると、
 * 「/」メニューの項目の取り直しが止まらない不具合をテストが見逃す
 * （`useLoadSuggestionMenuItems` は `getItems` の参照が変わるたびに取り直す）。
 * 実機と同じく、1つを使い回す。
 */
// 本物の insertBlocks は「入れたブロック」を返す。入れた行へカーソルを移すのに使うので、
// モックでも同じように返す
const mockInsertBlocks = vi.fn(
  (_blocks: Array<Record<string, unknown>>, _anchor: unknown, _placement?: string) => [
    { id: 'inserted-1', type: 'checkListItem' },
  ]
)
const mockSetTextCursorPosition = vi.fn()
let mockCursorBlockId: string | undefined
const mockEditor = {
  document: mockDocument,
  insertInlineContent: mockInsertInlineContent,
  insertBlocks: mockInsertBlocks,
  setTextCursorPosition: mockSetTextCursorPosition,
  getTextCursorPosition: () => ({ block: { id: mockCursorBlockId } }),
  focus: mockEditorFocus,
}

/** 「タスクにする行」のパネルは Wiki の一覧を読むので、ここでは差し替えて入口だけ見る */
let capturedTaskLineInsert: ((draft: { title: string; due?: string }) => void) | undefined
vi.mock('@/components/meeting/MinutesTaskLinePanel', () => ({
  MinutesTaskLinePanel: ({ onInsert }: { onInsert: (draft: { title: string }) => void }) => {
    capturedTaskLineInsert = onInsert
    return <div data-testid="minutes-task-line-panel" />
  },
}))
const mockUseCreateBlockNote = vi.fn((_opts: unknown) => mockEditor)

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
  { key: 'toggle_list', title: '折りたたみリスト', aliases: ['toggle'], group: '基本ブロック', onItemClick: () => {} },
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

let capturedOnSelect: ((selection: AppLinkSelection) => void) | undefined
vi.mock('@/components/editor/AppLinkPicker', () => ({
  AppLinkPicker: ({ onSelect }: { onSelect: (selection: AppLinkSelection) => void }) => {
    capturedOnSelect = onSelect
    return <div data-testid="app-link-picker" />
  },
}))

/** 会議メモを入れる処理。本物は editor のカーソルを読むので、何を渡したかだけ見る */
const mockInsertOrUpdateBlock = vi.fn()
vi.mock('@blocknote/core/extensions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/core/extensions')>()
  return {
    ...actual,
    insertOrUpdateBlockForSlashMenu: (...args: unknown[]) => mockInsertOrUpdateBlock(...args),
  }
})

describe('会議メモに書いた人の名前を残す', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedSlashMenuProps = undefined
  })

  it('「会議メモ」ボタンで、書いた日時と書いた人の名前を持つ会議メモを入れる', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} noteAuthorName="高橋 優太" />)
    fireEvent.click(screen.getByTestId('minutes-insert-meeting-note'))
    expect(mockInsertOrUpdateBlock).toHaveBeenCalledWith(mockEditor, {
      type: 'meetingNote',
      props: { createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), author: '高橋 優太' },
    })
  })

  it('名前が分からないときは名前を空のまま入れる（日時だけが出る）', () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByTestId('minutes-insert-meeting-note'))
    expect(mockInsertOrUpdateBlock).toHaveBeenCalledWith(mockEditor, {
      type: 'meetingNote',
      props: { createdAt: expect.any(String), author: '' },
    })
  })

  /**
   * 名前はメンバー一覧を読み終えてから届く。届いたときに「/」メニューの項目の取り方まで
   * 作り直すと、開いているメニューが取り直しになる（過去に事故った箇所）ので、作り直さずに
   * 押した時点の名前を使う。
   */
  it('名前があとから届いても「/」メニューの取り方は作り直さず、届いた名前で入れる', () => {
    const { rerender } = render(
      <MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} noteAuthorName="" onChange={() => {}} />
    )
    const first = capturedSlashMenuProps!.getItems
    rerender(
      <MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} noteAuthorName="高橋 優太" onChange={() => {}} />
    )
    expect(capturedSlashMenuProps!.getItems).toBe(first)

    fireEvent.click(screen.getByTestId('minutes-insert-meeting-note'))
    expect(mockInsertOrUpdateBlock).toHaveBeenCalledWith(
      mockEditor,
      expect.objectContaining({ props: expect.objectContaining({ author: '高橋 優太' }) })
    )
  })
})

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
      capturedOnSelect?.({ link: { href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=page-1`, label: '議事録テンプレ' } })
    )

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: `/${ORG_ID}/project/${SPACE_ID}/wiki?page=page-1`, content: '議事録テンプレ' },
    ])
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
    // そのまま書き続けられるよう、本文にカーソルを戻す
    expect(mockEditorFocus).toHaveBeenCalled()
  })

  it('社内のみのファイルを選んだときだけパネルを開いたままにする', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('リンクを挿入'))
    await screen.findByTestId('app-link-picker')

    act(() => capturedOnSelect?.({ link: { href: '/api/files/file-42/download', label: '仕様書.pdf' }, keepOpen: true }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-42/download', content: '仕様書.pdf' },
    ])
    expect(await screen.findByTestId('app-link-picker')).toBeInTheDocument()
    // 注意を読んでもらう間は本文に戻さない
    expect(mockEditorFocus).not.toHaveBeenCalled()
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

describe('TaskMetaChip（担当者・マイルストーンの印）', () => {
  it('担当者は名前の前に「担当:」を付けて出す', () => {
    render(<TaskMetaChip kind="assignee" name="田中" />)
    expect(screen.getByTestId('minutes-assignee-chip')).toHaveTextContent('担当: 田中')
  })

  it('マイルストーンは名前をそのまま出す', () => {
    render(<TaskMetaChip kind="milestone" name="第1弾" />)
    expect(screen.getByTestId('minutes-milestone-chip')).toHaveTextContent('第1弾')
  })

  /**
   * 名前は印に一緒に書いてあるものを出すだけ。手で消されたときに何も出ないと、
   * 担当者が付いているのに画面から消えてしまうので、印があることだけは伝える。
   */
  it('名前が無ければ「不明」と出す（印があることは伝える）', () => {
    render(<TaskMetaChip kind="assignee" name="" />)
    expect(screen.getByTestId('minutes-assignee-chip')).toHaveTextContent('担当: 不明')
  })

  it('編集できない（content:none）ので contentEditable=false を持つ', () => {
    render(<TaskMetaChip kind="milestone" name="第1弾" />)
    expect(screen.getByTestId('minutes-milestone-chip')).toHaveAttribute('contenteditable', 'false')
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
    // 会議中にいちばん使うのは「会議メモ」なので先頭に置く（ユーザー要望・2026-09-15）
    expect(items.map((item) => item.key)).toEqual([
      'insert_meeting_note',
      'insert_task_line',
      'insert_toc',
      'insert_link_task',
      'insert_link_file',
      'insert_link_wiki',
      'insert_link_meeting',
      'heading',
      'bullet_list',
      'check_list',
      'table',
      'code_block',
      'toggle_list',
    ])
  })

  it('「会議メモ」と「折りたたみリスト」を出す', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const keys = (await capturedSlashMenuProps!.getItems!('')).map((item) => item.key)
    expect(keys).toContain('insert_meeting_note')
    expect(keys).toContain('toggle_list')
  })

  it('「メモ」で絞り込むと会議メモが出る', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('メモ')
    expect(items.map((item) => item.key)).toEqual(['insert_meeting_note'])
  })

  it('「/」のあとに打った文字で絞り込む', async () => {
    render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('見出し')
    expect(items.map((item) => item.key)).toEqual(['heading'])
  })

  it('本文の下に「会議メモ」ボタンを出す（「/」を知らなくても押せるように）', () => {
    const { unmount } = render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByTestId('minutes-insert-meeting-note')).toBeInTheDocument()
    unmount()
    render(<MinutesEditor minutesMd="" editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('minutes-insert-meeting-note')).not.toBeInTheDocument()
  })

  /**
   * 描き直しのたびに `getItems` が別物になると、メニューを開いている間ずっと
   * 項目を取り直して点滅・固まりになる（過去に事故った箇所）。入口を増やすたびに
   * 壊れやすいので、参照が変わらないことを見張る。
   */
  it('画面を描き直しても「/」メニューの項目の取り方は同じものを使い回す', () => {
    // onChange を毎回別の関数にして、本当に描き直させる（この部品は memo で
    // 包まれているので、props が同じだと描き直しが起きずテストにならない）
    const { rerender } = render(
      <MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} onChange={() => {}} />
    )
    const first = capturedSlashMenuProps!.getItems
    rerender(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} onChange={() => {}} />)
    expect(capturedSlashMenuProps!.getItems).toBe(first)
  })

  describe('タスクにする行', () => {
    beforeEach(() => {
      mockInsertBlocks.mockClear()
      mockSetTextCursorPosition.mockClear()
      mockEditorFocus.mockClear()
      capturedTaskLineInsert = undefined
      mockCursorBlockId = undefined
      // 折りたたみ(b)の中(b1)にカーソルがある文書
      mockDocument.splice(0, mockDocument.length, { id: 'a' }, { id: 'b', children: [{ id: 'b1' }] })
    })

    // パネルは押したときだけ読み込む（next/dynamic）ので、出るのを待つ
    it('ボタンでパネルを開け閉めできる', async () => {
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      expect(screen.queryByTestId('minutes-task-line-panel')).not.toBeInTheDocument()
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      expect(await screen.findByTestId('minutes-task-line-panel')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      expect(screen.queryByTestId('minutes-task-line-panel')).not.toBeInTheDocument()
    })

    it('読み取り専用のときはボタンを出さない', () => {
      render(<MinutesEditor minutesMd="" editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
      expect(screen.queryByTestId('minutes-insert-task-line')).not.toBeInTheDocument()
    })

    /**
     * 「/」から選ぶ道は、ボタンから開く道と別の入口。項目が一覧に出ることだけを見ていて
     * 押したあとを見ていなかったため、「選んでも何も起きない」に気づけなかった。
     */
    it('「/」メニューから選んでもパネルが開く', async () => {
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      const items = (await capturedSlashMenuProps!.getItems!('')) as unknown as Array<{
        key: string
        onItemClick: () => void
      }>
      const item = items.find((i) => i.key === 'insert_task_line')!
      act(() => item.onItemClick())
      expect(await screen.findByTestId('minutes-task-line-panel')).toBeInTheDocument()
    })

    it('入れ子の中で押しても、字下げされない場所に入れる', async () => {
      mockCursorBlockId = 'b1'
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      await screen.findByTestId('minutes-task-line-panel')
      capturedTaskLineInsert!({ title: '見積を出す' })
      const [blocks, anchor, placement] = mockInsertBlocks.mock.calls[0]
      // 入れ子の b1 ではなく、その大元の b の後ろに入れる
      expect((anchor as { id: string }).id).toBe('b')
      expect(placement).toBe('after')
      expect(blocks[0]).toMatchObject({ type: 'checkListItem', props: { checked: false } })
    })

    /**
     * 入る場所は**カーソルのあった行の後ろ**＝画面の上のほう。パネルは本文のいちばん下に
     * 出るので、入れても手元では何も変わらず「入っていない」ように見えていた
     * （ユーザー報告・2026-09-15）。入れた行にカーソルを移して、そこまで画面を動かす。
     */
    it('入れた行にカーソルを移す（入った場所が画面の外にならないように）', async () => {
      mockCursorBlockId = 'b1'
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      await screen.findByTestId('minutes-task-line-panel')
      act(() => capturedTaskLineInsert!({ title: '見積を出す' }))
      expect(mockSetTextCursorPosition).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inserted-1' }),
        'end'
      )
      expect(mockEditorFocus).toHaveBeenCalled()
    })

    it('入れた行そのものを画面に寄せる（カーソルを置くだけでは画面が動かないため）', async () => {
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      await screen.findByTestId('minutes-task-line-panel')
      // 本物の BlockNote は行に data-id を振る。寄せ先が見つかる状態を作る
      const row = document.createElement('div')
      row.setAttribute('data-id', 'inserted-1')
      const scrollIntoView = vi.fn()
      row.scrollIntoView = scrollIntoView
      screen.getByTestId('blocknote-view').appendChild(row)
      act(() => capturedTaskLineInsert!({ title: '見積を出す' }))
      expect(scrollIntoView).toHaveBeenCalled()
    })

    it('入れたらパネルを閉じる', async () => {
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      await screen.findByTestId('minutes-task-line-panel')
      act(() => capturedTaskLineInsert!({ title: '見積を出す' }))
      expect(screen.queryByTestId('minutes-task-line-panel')).not.toBeInTheDocument()
    })

    it('やることが空なら何も入れない', async () => {
      render(<MinutesEditor minutesMd="" editable orgId={ORG_ID} spaceId={SPACE_ID} />)
      fireEvent.click(screen.getByTestId('minutes-insert-task-line'))
      await screen.findByTestId('minutes-task-line-panel')
      act(() => capturedTaskLineInsert!({ title: '   ' }))
      expect(mockInsertBlocks).not.toHaveBeenCalled()
    })
  })

  it('読み取り専用のときはメニューを出さない', () => {
    render(<MinutesEditor minutesMd="" editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(capturedSlashMenuProps).toBeUndefined()
  })
})
