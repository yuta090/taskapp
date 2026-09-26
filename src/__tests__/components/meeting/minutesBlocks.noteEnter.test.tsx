// @vitest-environment jsdom
/**
 * メモ（議事録では「会議メモ」）の中で Enter を押したときの動き。
 *
 * 既定の BlockNote は Enter で行を割り、メモの下に空の行を1つ足していた。メモは1つ書いたら
 * 終わりの使い方が多いので、**行は増やさず、すぐ下の行へカーソルを移す**（ユーザー指定・
 * 2026-09-26）。BlockNote は本文の末尾に空の行を必ず1つ持つので、最後のメモならその行へ移る。
 * 下に書ける行が1つも無いとき（区切り線だけなど）は、カーソルを外して編集を終える。
 * メモの中で改行したいときは Shift+Enter（ここは変えない）。
 *
 * 本物の BlockNote を画面なしで載せ、キーを押したのと同じ経路（ProseMirror の keydown）で確かめる。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import { DIVIDER_TYPE, MEETING_NOTE_TYPE } from '@/lib/minutes/markdown'
import { dividerSpec, meetingNoteSpec } from '@/components/meeting/minutesBlocks'

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    [DIVIDER_TYPE]: dividerSpec,
    [MEETING_NOTE_TYPE]: meetingNoteSpec,
  },
  styleSpecs: { bold: defaultStyleSpecs.bold },
  inlineContentSpecs: { text: defaultInlineContentSpecs.text, link: defaultInlineContentSpecs.link },
})

type AnyEditor = BlockNoteEditor<never, never, never>
const mounted: { editor: AnyEditor; host: HTMLElement }[] = []

afterEach(() => {
  while (mounted.length) {
    const entry = mounted.pop()
    entry?.editor.unmount()
    entry?.host.remove()
  }
})

function mountWith(blocks: unknown[]): AnyEditor {
  const editor = BlockNoteEditor.create({ schema, initialContent: blocks as never }) as unknown as AnyEditor
  const host = document.createElement('div')
  document.body.appendChild(host)
  editor.mount(host)
  mounted.push({ editor, host })
  return editor
}

/** キーボードで押したのと同じ経路で渡す。拾われたら true */
function press(editor: AnyEditor, key: string, opts: { shiftKey?: boolean } = {}): boolean {
  const view = editor.prosemirrorView!
  const event = new KeyboardEvent('keydown', { key, shiftKey: !!opts.shiftKey, bubbles: true })
  return !!view.someProp('handleKeyDown', (f) => f(view, event))
}

const note = (text: string) => ({
  type: MEETING_NOTE_TYPE,
  content: [{ type: 'text', text, styles: {} }],
})
const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text, styles: {} }] : [] })

function cursorBlockId(editor: AnyEditor): string {
  return (editor.getTextCursorPosition().block as unknown as { id: string }).id
}

/** 各行の文字。BlockNote が末尾に必ず持つ空の行は数えない */
function texts(editor: AnyEditor): string[] {
  const all = (editor.document as unknown as { content?: { text?: string }[] }[]).map(
    (b) => b.content?.map((c) => c.text ?? '').join('') ?? ''
  )
  return all.at(-1) === '' ? all.slice(0, -1) : all
}

describe('メモの中で Enter を押したとき', () => {
  it('行は増えず、すぐ下の行の先頭へカーソルが移る', () => {
    const editor = mountWith([note('補足です'), para('次の行')])
    const [memo, next] = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(memo as never, 'end')

    expect(press(editor, 'Enter')).toBe(true)

    expect(texts(editor)).toEqual(['補足です', '次の行'])
    expect(cursorBlockId(editor)).toBe(next.id)
    expect(editor.prosemirrorView!.state.selection.$from.parentOffset).toBe(0)
  })

  it('文の途中で押しても、メモは割れない', () => {
    const editor = mountWith([note('補足です'), para('次の行')])
    const [memo, next] = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(memo as never, 'start')

    press(editor, 'Enter')

    expect(texts(editor)).toEqual(['補足です', '次の行'])
    expect(cursorBlockId(editor)).toBe(next.id)
  })

  it('すぐ下が区切り線なら、それを飛ばして次に書ける行へ移る', () => {
    const editor = mountWith([note('補足'), { type: DIVIDER_TYPE }, para('その次')])
    const blocks = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(blocks[0] as never, 'end')

    press(editor, 'Enter')

    expect(editor.document).toHaveLength(blocks.length)
    expect(cursorBlockId(editor)).toBe(blocks[2].id)
  })

  it('最後のメモなら、行を足さずに末尾の空の行へ移る', () => {
    const editor = mountWith([para('前の行'), note('最後のメモ')])
    const blocks = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(blocks[1] as never, 'end')

    expect(press(editor, 'Enter')).toBe(true)

    expect(editor.document).toHaveLength(blocks.length)
    expect(texts(editor)).toEqual(['前の行', '最後のメモ'])
    expect(cursorBlockId(editor)).toBe(blocks.at(-1)!.id)
  })

  it('下に書ける行が1つも無ければ、行を足さずに編集を終える', () => {
    const editor = mountWith([note('メモ'), { type: DIVIDER_TYPE }])
    // 末尾の空の行を消して、区切り線で終わる本文にする
    const last = editor.document.at(-1) as unknown as { id: string; type: string }
    if (last.type === 'paragraph') editor.removeBlocks([last as never])
    const blocks = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(blocks[0] as never, 'end')
    editor.focus()

    expect(press(editor, 'Enter')).toBe(true)

    expect(editor.document).toHaveLength(blocks.length)
    expect(editor.isFocused()).toBe(false)
  })

  it('Shift+Enter はこれまでどおりメモの中で改行する', () => {
    const editor = mountWith([note('補足'), para('次の行')])
    const [memo] = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(memo as never, 'end')

    press(editor, 'Enter', { shiftKey: true })

    expect(texts(editor)).toEqual(['補足\n', '次の行'])
    expect(cursorBlockId(editor)).toBe(memo.id)
  })

  it('メモ以外の行の Enter は変えない（行が割れて1つ増える）', () => {
    const editor = mountWith([para('ふつうの行'), note('補足')])
    const [first] = editor.document as unknown as { id: string }[]
    editor.setTextCursorPosition(first as never, 'end')

    press(editor, 'Enter')

    expect(texts(editor)).toEqual(['ふつうの行', '', '補足'])
  })
})
