// @vitest-environment jsdom
/**
 * Wiki の囲み（callout）。長い文書の中で「補足・ポイント・結論・注意・禁止」を色で見分けられる
 * ようにする（ユーザー要望・2026-11-02）。CLI からは GitHub のアラート（`> [!NOTE]` など）で書く。
 *
 * - 種類は5つだけ。色ではなく意味で選ぶ
 * - 中には段落・箇条書きを複数入れられる（子のブロック）
 * - Enter の動きは Notion と同じ: 題名の行で押すと中の先頭へ、中の最後の空行で押すと囲みの外へ
 *
 * 本物の BlockNote を画面なしで載せて確かめる。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import {
  CALLOUT_KINDS,
  CALLOUT_TYPE,
  CalloutView,
  buildCalloutSlashItems,
  calloutSpec,
  enterInCallout,
} from '@/components/wiki/blocks/calloutBlock'

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    [CALLOUT_TYPE]: calloutSpec,
  },
  styleSpecs: { bold: defaultStyleSpecs.bold },
  inlineContentSpecs: { text: defaultInlineContentSpecs.text, link: defaultInlineContentSpecs.link },
})

type AnyEditor = BlockNoteEditor<never, never, never>
type Blk = { id: string; type: string; props: Record<string, unknown>; content?: { text?: string }[]; children: Blk[] }
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
const textOf = (b: Blk) => (b.content ?? []).map((c) => c.text ?? '').join('')

describe('囲みの種類', () => {
  it('補足・ポイント・結論・注意・禁止の5つで、GitHub のアラート名と対になる', () => {
    expect(CALLOUT_KINDS.map((k) => [k.kind, k.label, k.alert])).toEqual([
      ['note', '補足', 'NOTE'],
      ['tip', 'ポイント', 'TIP'],
      ['important', '結論', 'IMPORTANT'],
      ['warning', '注意', 'WARNING'],
      ['caution', '禁止', 'CAUTION'],
    ])
  })

  it('CLI が作る形（content と children）をそのまま読める', () => {
    const editor = mountWith([
      {
        type: CALLOUT_TYPE,
        props: { kind: 'warning' },
        content: '期限は 11/16',
        children: [
          { type: 'paragraph', content: '2つ目の段落' },
          { type: 'bulletListItem', content: '条件A' },
        ],
      },
    ])
    const [callout] = docOf(editor)
    expect(callout.type).toBe(CALLOUT_TYPE)
    expect(callout.props.kind).toBe('warning')
    expect(textOf(callout)).toBe('期限は 11/16')
    expect(callout.children.map((c) => c.type)).toEqual(['paragraph', 'bulletListItem'])
  })

  it('画面には種類の名前と、色を引く data-callout-kind が出る。名前を押すと種類を変えられる', () => {
    const changed: string[] = []
    render(<CalloutView kind="tip" editable onChangeKind={(k) => changed.push(k)} contentRef={() => {}} />)
    expect(screen.getByTestId('wiki-callout').getAttribute('data-callout-kind')).toBe('tip')
    fireEvent.click(screen.getByTestId('wiki-callout-label'))
    expect(screen.getByTestId('wiki-callout-label').textContent).toContain('ポイント')
    fireEvent.click(screen.getByRole('menuitemradio', { name: /禁止/ }))
    expect(changed).toEqual(['caution'])
  })

  it('読むだけの画面では種類を変えられない', () => {
    render(<CalloutView kind="note" editable={false} onChangeKind={() => {}} contentRef={() => {}} />)
    expect((screen.getByTestId('wiki-callout-label') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('囲みの中の Enter', () => {
  it('題名の行で押すと、中の先頭に空の行を足してそこへ移る', () => {
    const editor = mountWith([{ type: CALLOUT_TYPE, props: { kind: 'note' }, content: '前提' }])
    editor.setTextCursorPosition(docOf(editor)[0].id as never, 'end')

    expect(enterInCallout(editor as never)).toBe(true)

    const [callout] = docOf(editor)
    expect(callout.children).toHaveLength(1)
    expect(callout.children[0].type).toBe('paragraph')
    expect((editor.getTextCursorPosition().block as unknown as Blk).id).toBe(callout.children[0].id)
  })

  it('中の最後の空の行で押すと、その行を囲みの外（すぐ下）へ出す', () => {
    const editor = mountWith([
      { type: CALLOUT_TYPE, props: { kind: 'note' }, content: '前提', children: [{ type: 'paragraph', content: '補足' }, { type: 'paragraph' }] },
    ])
    const last = docOf(editor)[0].children[1]
    editor.setTextCursorPosition(last.id as never, 'start')

    expect(enterInCallout(editor as never)).toBe(true)

    const doc = docOf(editor)
    expect(doc[0].children.map(textOf)).toEqual(['補足'])
    expect(doc[1].type).toBe('paragraph')
    expect((editor.getTextCursorPosition().block as unknown as Blk).id).toBe(doc[1].id)
  })

  it('中身の無い囲みで押すと、普通の行に戻す', () => {
    const editor = mountWith([{ type: CALLOUT_TYPE, props: { kind: 'note' } }])
    editor.setTextCursorPosition(docOf(editor)[0].id as never, 'start')

    expect(enterInCallout(editor as never)).toBe(true)
    expect(docOf(editor)[0].type).toBe('paragraph')
  })

  it('囲みと関係ない行では何もしない（既定の Enter に任せる）', () => {
    const editor = mountWith([{ type: 'paragraph', content: 'ふつう' }])
    editor.setTextCursorPosition(docOf(editor)[0].id as never, 'end')
    expect(enterInCallout(editor as never)).toBe(false)
  })
})

describe('「/」メニューの囲み', () => {
  it('5種類を並べ、「/補足」「/note」「/かこみ」で探せる', () => {
    const items = buildCalloutSlashItems(mountWith([{ type: 'paragraph' }]))
    expect(items.map((i) => i.title)).toEqual(['補足', 'ポイント', '結論', '注意', '禁止'])
    const note = items[0]
    expect(note.aliases).toEqual(expect.arrayContaining(['note', '補足', 'かこみ', 'callout']))
  })

  it('押すと、いまの行を選んだ種類の囲みにする', () => {
    const editor = mountWith([{ type: 'paragraph', content: '' }])
    editor.setTextCursorPosition(docOf(editor)[0].id as never, 'start')

    buildCalloutSlashItems(editor).find((i) => i.key === 'callout_caution')!.onItemClick()

    const [b] = docOf(editor)
    expect(b.type).toBe(CALLOUT_TYPE)
    expect(b.props.kind).toBe('caution')
  })
})
