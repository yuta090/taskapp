import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WikiEditor } from '@/components/wiki/WikiEditor'
import type { AppLinkSelection } from '@/components/editor/AppLinkPicker'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

const mockInsertInlineContent = vi.fn()
const mockEditorFocus = vi.fn()
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

/**
 * 本物の `useCreateBlockNote` は **マウント中ずっと同じ editor を返す**。毎回別のものを返す
 * モックにすると、「/」メニューの項目の取り方が描き直しのたびに変わってしまい、
 * 取り方が変わらないことを確かめるテストが書けない（MinutesEditor.test.tsx と同じ作り）。
 */
const mockEditor = {
  document: [],
  insertInlineContent: mockInsertInlineContent,
  focus: mockEditorFocus,
  insertBlocks: mockInsertBlocks,
  getTextCursorPosition: mockGetTextCursorPosition,
}

// BlockNote mounts a real ProseMirror editor which is heavy/unstable in jsdom.
// Mock the hook and view so this test focuses on the toolbar wiring instead.
vi.mock('@blocknote/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/react')>()
  return {
    ...actual,
    useCreateBlockNote: (options: typeof capturedEditorOptions) => {
      capturedEditorOptions = options
      return mockEditor
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

/** メモを入れる処理。本物は editor のカーソルを読むので、何を渡したかだけ見る */
const mockInsertOrUpdateBlock = vi.fn()
vi.mock('@blocknote/core/extensions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@blocknote/core/extensions')>()
  return {
    ...actual,
    insertOrUpdateBlockForSlashMenu: (...args: unknown[]) => mockInsertOrUpdateBlock(...args),
  }
})

/**
 * 議事録の「会議メモ」を Wiki でも「メモ」として使う。書いた人の名前と日時が添わる。
 * 相手先ポータルの Wiki も同じエディタ（読み取り専用）で出すので、スキーマに入っていれば
 * ポータルでも同じ見た目で読める。
 */
describe('WikiEditor のメモ', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedEditorOptions = undefined
    capturedSlashMenuProps = undefined
  })

  it('メモのブロックをスキーマに持つ（ポータルの読み取り専用表示でも描ける）', () => {
    render(<WikiEditor editable={false} />)
    const schema = (capturedEditorOptions as unknown as { schema: { blockSpecs: Record<string, unknown> } }).schema
    expect(schema.blockSpecs).toHaveProperty('meetingNote')
  })

  it('「メモ」で絞り込むとメモが出る', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = await capturedSlashMenuProps!.getItems!('メモ')
    expect(items.map(item => item.key)).toEqual(['insert_note'])
  })

  it('本文の下に「メモ」ボタンを出す。読み取り専用なら出さない', () => {
    const { unmount } = render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByTestId('wiki-insert-note')).toBeInTheDocument()
    unmount()
    render(<WikiEditor editable={false} orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('wiki-insert-note')).not.toBeInTheDocument()
  })

  // PDFで保存したときに、本文の下の差し込みツールバーが紙に載らないようにする印。
  // 印を外すと、押しても何も起きないボタンの列が PDF の末尾に刷られる
  it('本文の下の差し込みツールバーには「紙に載せない」印が付いている', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.getByTestId('wiki-insert-note').closest('[data-print-hide]')).not.toBeNull()
  })

  it('「メモ」ボタンで、書いた日時と書いた人の名前を持つメモを入れる', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} noteAuthorName="高橋 優太" />)
    fireEvent.click(screen.getByTestId('wiki-insert-note'))
    expect(mockInsertOrUpdateBlock).toHaveBeenCalledWith(expect.anything(), {
      type: 'meetingNote',
      props: { createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), author: '高橋 優太' },
    })
  })

  it('名前があとから届いても「/」メニューの取り方は作り直さず、届いた名前で入れる', () => {
    const { rerender } = render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} noteAuthorName="" />)
    const first = capturedSlashMenuProps!.getItems
    rerender(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} noteAuthorName="高橋 優太" />)
    expect(capturedSlashMenuProps!.getItems).toBe(first)

    fireEvent.click(screen.getByTestId('wiki-insert-note'))
    expect(mockInsertOrUpdateBlock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ props: expect.objectContaining({ author: '高橋 優太' }) })
    )
  })
})

let capturedOnSelect: ((selection: AppLinkSelection) => void) | undefined

vi.mock('@/components/editor/AppLinkPicker', () => ({
  AppLinkPicker: ({ onSelect }: { onSelect: (selection: AppLinkSelection) => void }) => {
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

    act(() => capturedOnSelect?.({ link: { href: '/org-1/project/space-1?task=t1', label: 'TP-42 直す' } }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/org-1/project/space-1?task=t1', content: 'TP-42 直す' },
    ])
    expect(screen.queryByTestId('app-link-picker')).not.toBeInTheDocument()
    // そのまま書き続けられるよう、本文にカーソルを戻す
    expect(mockEditorFocus).toHaveBeenCalled()
  })

  it('社内のみのファイルを選んだときだけパネルを開いたままにする', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    fireEvent.click(screen.getByText('リンクを挿入'))
    await screen.findByTestId('app-link-picker')

    act(() => capturedOnSelect?.({ link: { href: '/api/files/file-99/download', label: '内部メモ.txt' }, keepOpen: true }))

    expect(mockInsertInlineContent).toHaveBeenCalledWith([
      { type: 'link', href: '/api/files/file-99/download', content: '内部メモ.txt' },
    ])
    expect(await screen.findByTestId('app-link-picker')).toBeInTheDocument()
    // 注意を読んでもらう間は本文に戻さない
    expect(mockEditorFocus).not.toHaveBeenCalled()
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
    // 先頭はメモ、次に自前のリンク4種。そのあとが BlockNote の既定（video/audio を除く）
    expect(items.map(item => item.key)).toEqual([
      'insert_note',
      'insert_toc',
      'insert_link_task',
      'insert_link_file',
      'insert_link_wiki',
      'insert_link_meeting',
      'heading', 'bullet_list', 'image', 'file',
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

vi.mock('@/lib/hooks/useDocPolls', () => ({
  useDocPolls: () => ({ polls: {}, isFetched: false, castVote: vi.fn(), createPoll: vi.fn() }),
}))

/**
 * 投票ブロック（DOC_VOTE_SPEC）。「/v」「/投票」で理由任意、「/votemust」「/必須」で理由必須。
 * 相手先ポータルのように投票を配らない画面では「/」に出さない。
 */
describe('WikiEditor の投票', () => {
  const POLL = { wikiPageId: 'page-1', currentUserId: 'me', nameOf: () => '高橋' }
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

  beforeEach(() => {
    vi.clearAllMocks()
    capturedEditorOptions = undefined
    capturedSlashMenuProps = undefined
  })

  it('投票のブロックをスキーマに持つ（ポータルの読み取り専用表示でも描ける）', () => {
    render(<WikiEditor editable={false} />)
    const schema = (capturedEditorOptions as unknown as { schema: { blockSpecs: Record<string, unknown> } }).schema
    expect(schema.blockSpecs).toHaveProperty('docPoll')
  })

  it('「/v」で投票がいちばん上に出る', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} poll={POLL} />)
    const items = await capturedSlashMenuProps!.getItems!('v')
    expect(items.slice(0, 2).map((i) => i.key)).toEqual(['insert_vote', 'insert_vote_must'])
  })

  it('「/vote」では両方、「/votem」では理由必須だけが出る', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} poll={POLL} />)
    const vote = (await capturedSlashMenuProps!.getItems!('vote')).map((i) => i.key)
    expect(vote).toEqual(expect.arrayContaining(['insert_vote', 'insert_vote_must']))
    const must = (await capturedSlashMenuProps!.getItems!('votem')).map((i) => i.key)
    expect(must).toEqual(['insert_vote_must'])
  })

  it('日本語でも出る（投票・必須）', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} poll={POLL} />)
    expect((await capturedSlashMenuProps!.getItems!('投票')).map((i) => i.key)).toEqual([
      'insert_vote',
      'insert_vote_must',
    ])
    expect((await capturedSlashMenuProps!.getItems!('必須')).map((i) => i.key)).toEqual(['insert_vote_must'])
  })

  it('押すと、新しい番号と理由必須の設定を持つ投票ブロックを置く', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} poll={POLL} />)
    const [plain] = (await capturedSlashMenuProps!.getItems!('投票')) as unknown as Array<{ onItemClick: () => void }>
    plain.onItemClick()
    expect(mockInsertOrUpdateBlock).toHaveBeenLastCalledWith(expect.anything(), {
      type: 'docPoll',
      props: { pollId: expect.stringMatching(UUID), reasonRequired: 'none' },
    })
    const [must] = (await capturedSlashMenuProps!.getItems!('必須')) as unknown as Array<{ onItemClick: () => void }>
    must.onItemClick()
    expect(mockInsertOrUpdateBlock).toHaveBeenLastCalledWith(expect.anything(), {
      type: 'docPoll',
      props: { pollId: expect.stringMatching(UUID), reasonRequired: 'ng_hold' },
    })
  })

  it('投票を配らない画面（ポータルなど）では「/」に出さない', async () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} />)
    const items = (await capturedSlashMenuProps!.getItems!('投票')).map((i) => i.key)
    expect(items).toEqual([])
  })

  it('議題が空の行には案内を出す', () => {
    render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} poll={POLL} />)
    expect(capturedEditorOptions?.dictionary?.placeholders.docPoll).toBe('議題（書かなくてもよい）')
  })
})

// 見出しのリンク。中身は HeadingLinks.test.tsx で確かめるので、ここは「渡したか」だけを見る
vi.mock('@/components/editor/HeadingLinks', () => ({
  HeadingLinks: ({ pageTitle, editor }: { pageTitle: string; editor: unknown }) => (
    <div data-testid="heading-links" data-title={pageTitle} data-same-editor={String(editor === mockEditor)} />
  ),
}))

describe('WikiEditor の見出しリンク', () => {
  it('ページ名を渡すと、見出しのリンク（コピーと # での移動）を載せる。閲覧中でも載せる', () => {
    render(<WikiEditor editable={false} orgId={ORG_ID} spaceId={SPACE_ID} headingLinkTitle="運用メモ" />)
    const el = screen.getByTestId('heading-links')
    expect(el).toHaveAttribute('data-title', '運用メモ')
    expect(el).toHaveAttribute('data-same-editor', 'true')
  })

  it('ページ名を渡さない画面（相手先ポータル）には載せない', () => {
    render(<WikiEditor editable={false} />)
    expect(screen.queryByTestId('heading-links')).toBeNull()
  })

  it('ボタンの位置の基準にするため、本文の枠を relative にする', () => {
    const { container } = render(<WikiEditor editable orgId={ORG_ID} spaceId={SPACE_ID} headingLinkTitle="運用メモ" />)
    expect(container.querySelector('.wiki-editor')).toHaveClass('relative')
  })
})
