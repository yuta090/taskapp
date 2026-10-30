// @vitest-environment jsdom
/**
 * Wiki の背景色を Notion と同じように付けられるようにする（ユーザー要望・2026-10-30）。
 *
 * - 表のブロックは BlockNote の既定では文字色しか持たず、行の左の「⠿ → 色を変更」に
 *   背景色が出なかった。Wiki の表には背景色を足す
 * - 「/」メニューから、いまの行の背景色を選べる（Notion の「/赤 背景」と同じ）
 *
 * 本物の BlockNote を画面なしで載せて確かめる。
 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import { BLOCK_COLORS, buildBackgroundColorSlashItems } from '@/components/wiki/blockColors'
import { wikiTableSpec } from '@/components/wiki/blocks/wikiTableSpec'

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    divider: defaultBlockSpecs.divider,
    table: wikiTableSpec,
  },
  styleSpecs: { bold: defaultStyleSpecs.bold },
  inlineContentSpecs: { text: defaultInlineContentSpecs.text },
})

type AnyEditor = BlockNoteEditor<never, never, never>
type Blk = { id: string; type: string; props: Record<string, unknown> }
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

const docOf = (editor: AnyEditor) => editor.document as unknown as Blk[]

const TABLE = {
  type: 'table',
  content: {
    type: 'tableContent',
    rows: [{ cells: ['a', 'b'] }],
  },
}

describe('Wiki の表の背景色', () => {
  it('表のブロックが背景色を持てる（「⠿ → 色を変更」に背景色が出る条件）', () => {
    expect(wikiTableSpec.config.propSchema).toHaveProperty('backgroundColor')
    expect(wikiTableSpec.config.propSchema).toHaveProperty('textColor')
  })

  it('表に付けた背景色が本文に残り、画面にも data-background-color で出る', () => {
    const editor = mountWith([TABLE])
    const table = docOf(editor)[0]
    editor.updateBlock(table.id as never, { props: { backgroundColor: 'yellow' } } as never)

    expect(docOf(editor)[0].props.backgroundColor).toBe('yellow')
    expect(editor.prosemirrorView!.dom.querySelector('[data-content-type="table"]')?.getAttribute('data-background-color')).toBe('yellow')
  })

  it('背景色を付けていない表は、本文に色を書かない（既定のまま）', () => {
    const editor = mountWith([TABLE])
    expect(docOf(editor)[0].props.backgroundColor).toBe('default')
  })
})

describe('「/」メニューの背景色', () => {
  it('既定以外の9色を、日本語の名前で並べる', () => {
    expect(BLOCK_COLORS.map((c) => c.value)).toEqual([
      'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red',
    ])
    const items = buildBackgroundColorSlashItems(mountWith([{ type: 'paragraph' }]))
    // 「背景を外す」を含めて10項目
    expect(items).toHaveLength(10)
    expect(items.find((i) => i.key === 'bg_yellow')?.title).toBe('背景：黄色')
  })

  it('「はいけい」「背景」「bg」と色の名前で探せる', () => {
    const items = buildBackgroundColorSlashItems(mountWith([{ type: 'paragraph' }]))
    const red = items.find((i) => i.key === 'bg_red')!
    expect(red.aliases).toEqual(expect.arrayContaining(['bg', 'haikei', 'はいけい', '背景', 'red', '赤']))
  })

  it('押すと、カーソルのある行の背景色が変わる', () => {
    const editor = mountWith([{ type: 'paragraph', content: 'あ' }, { type: 'paragraph', content: 'い' }])
    const second = docOf(editor)[1]
    editor.setTextCursorPosition(second.id as never, 'end')

    buildBackgroundColorSlashItems(editor).find((i) => i.key === 'bg_blue')!.onItemClick()

    expect(docOf(editor)[0].props.backgroundColor).toBe('default')
    expect(docOf(editor)[1].props.backgroundColor).toBe('blue')
  })

  it('「背景を外す」で既定に戻す', () => {
    const editor = mountWith([{ type: 'paragraph', content: 'あ', props: { backgroundColor: 'red' } }])
    editor.setTextCursorPosition(docOf(editor)[0].id as never, 'end')

    buildBackgroundColorSlashItems(editor).find((i) => i.key === 'bg_default')!.onItemClick()

    expect(docOf(editor)[0].props.backgroundColor).toBe('default')
  })
})
