// @vitest-environment jsdom
/**
 * 折りたたみ（トグル）を Notion と同じ感覚で使えるようにする（ユーザー指定・2026-09-28）。
 *
 * - 行頭で `>` ＋スペースを打つと折りたたみになる。Wiki では既定の引用ブロックが同じ打ち方を
 *   取っていて、折りたたみでなく引用になっていた。引用はメニューからだけ作る
 * - 折りたたみの題名を書いて Enter を押すと、**中身を書く行**へ移る。既定の BlockNote は
 *   題名を割って、下にもう1つ折りたたみを作っていた（リストの動き）
 * - 題名が空のまま Enter を押したときは、これまでどおり普通の行に戻す（折りたたみをやめる）
 *
 * 本物の BlockNote を画面なしで載せ、キーを押したのと同じ経路（ProseMirror）で確かめる。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import { TOGGLE_TYPE } from '@/lib/minutes/markdown'
import { quoteSpec, toggleListItemSpec } from '@/components/meeting/minutesBlocks'

// Wiki と同じく引用ブロックも入れておく（`>` の取り合いを確かめるため）
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    quote: quoteSpec,
    [TOGGLE_TYPE]: toggleListItemSpec,
  },
  styleSpecs: { bold: defaultStyleSpecs.bold },
  inlineContentSpecs: { text: defaultInlineContentSpecs.text, link: defaultInlineContentSpecs.link },
})

type AnyEditor = BlockNoteEditor<never, never, never>
type Blk = { id: string; type: string; content?: { text?: string }[]; children: Blk[] }
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

function press(editor: AnyEditor, key: string): boolean {
  const view = editor.prosemirrorView!
  const event = new KeyboardEvent('keydown', { key, bubbles: true })
  return !!view.someProp('handleKeyDown', (f) => f(view, event))
}

/** 1文字ずつ打つ（入力ルールが働くのと同じ経路） */
function typeText(editor: AnyEditor, text: string) {
  const view = editor.prosemirrorView!
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, () => view.state.tr))
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

const doc = (editor: AnyEditor) => editor.document as unknown as Blk[]
const textOf = (b: Blk) => b.content?.map((c) => c.text ?? '').join('') ?? ''
const cursorBlock = (editor: AnyEditor) => editor.getTextCursorPosition().block as unknown as Blk
const toggle = (text: string, children: unknown[] = []) => ({
  type: TOGGLE_TYPE,
  content: text ? [{ type: 'text', text, styles: {} }] : [],
  children,
})
const para = (text: string) => ({ type: 'paragraph', content: text ? [{ type: 'text', text, styles: {} }] : [] })

describe('「>」＋スペース', () => {
  it('折りたたみになる（引用にはならない）', () => {
    const editor = mountWith([para('')])
    editor.setTextCursorPosition(doc(editor)[0] as never, 'start')

    typeText(editor, '> ')

    expect(doc(editor)[0].type).toBe(TOGGLE_TYPE)
    expect(textOf(doc(editor)[0])).toBe('')
  })
})

describe('折りたたみの題名で Enter を押したとき', () => {
  it('折りたたみは増えず、中身を書く行へ移る', () => {
    const editor = mountWith([toggle('議題'), para('次の行')])
    editor.setTextCursorPosition(doc(editor)[0] as never, 'end')

    expect(press(editor, 'Enter')).toBe(true)

    const [head, next] = doc(editor)
    expect(head.type).toBe(TOGGLE_TYPE)
    expect(textOf(head)).toBe('議題')
    expect(head.children).toHaveLength(1)
    expect(head.children[0].type).toBe('paragraph')
    expect(cursorBlock(editor).id).toBe(head.children[0].id)
    expect(textOf(next)).toBe('次の行')
    expect(doc(editor).filter((b) => b.type === TOGGLE_TYPE)).toHaveLength(1)
  })

  it('中身がもうあるときは、その先頭に空の行を足してそこへ移る', () => {
    const editor = mountWith([toggle('議題', [para('既存の中身')])])
    editor.setTextCursorPosition(doc(editor)[0] as never, 'end')

    expect(press(editor, 'Enter')).toBe(true)

    const head = doc(editor)[0]
    expect(head.children.map(textOf)).toEqual(['', '既存の中身'])
    expect(cursorBlock(editor).id).toBe(head.children[0].id)
  })

  it('題名の途中で押しても題名は割らない', () => {
    const editor = mountWith([toggle('議題です')])
    editor.setTextCursorPosition(doc(editor)[0] as never, 'start')

    expect(press(editor, 'Enter')).toBe(true)

    expect(textOf(doc(editor)[0])).toBe('議題です')
    expect(cursorBlock(editor).id).toBe(doc(editor)[0].children[0].id)
  })

  it('題名が空なら、これまでどおり普通の行に戻る', () => {
    const editor = mountWith([toggle('')])
    editor.setTextCursorPosition(doc(editor)[0] as never, 'end')

    press(editor, 'Enter')

    expect(doc(editor)[0].type).toBe('paragraph')
  })

  it('中身の行で Enter を押すと、中身の中に次の行ができる（折りたたみの外へは出ない）', () => {
    const editor = mountWith([toggle('議題', [para('一行目')])])
    editor.setTextCursorPosition(doc(editor)[0].children[0] as never, 'end')

    press(editor, 'Enter')

    expect(doc(editor)[0].children).toHaveLength(2)
  })
})
