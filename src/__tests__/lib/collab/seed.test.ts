// @vitest-environment jsdom
/**
 * 同時編集の「種まき」の決定性を確かめる。
 *
 * ここがこの機能でいちばん踏みやすい穴（COEDITING_SPEC 5.3）。2人が同時に議事録を
 * 開き、それぞれが列の本文から別々に Y.Doc（同時編集の器）を作って合流すると、
 * **本文が丸ごと二重になる**。同じ本文からは byte 単位で同じ更新を作ることで防ぐ。
 */
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  nodeToBlock,
} from '@blocknote/core'
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import { serializeMinutesBlocks, TASK_MARKER_TYPE } from '@/lib/minutes/markdown'
import { buildMinutesSeed } from '@/lib/collab/seed'
import { MINUTES_FRAGMENT_NAME, minutesSeedHash } from '@/lib/collab/hash'

const taskMarkerSpec = createInlineContentSpec(
  { type: TASK_MARKER_TYPE, propSchema: { taskId: { default: '' } }, content: 'none' } as const,
  {
    render: () => {
      const dom = document.createElement('span')
      dom.dataset.taskMarker = 'true'
      return { dom }
    },
  }
)

const minutesSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    table: defaultBlockSpecs.table,
    codeBlock: defaultBlockSpecs.codeBlock,
  },
  styleSpecs: {
    bold: defaultStyleSpecs.bold,
    italic: defaultStyleSpecs.italic,
    strike: defaultStyleSpecs.strike,
    code: defaultStyleSpecs.code,
  },
  inlineContentSpecs: {
    text: defaultInlineContentSpecs.text,
    link: defaultInlineContentSpecs.link,
    [TASK_MARKER_TYPE]: taskMarkerSpec,
  },
})

/** pmSchema を取り出すためだけの器。画面には出さない */
const editor = BlockNoteEditor.create({ schema: minutesSchema })

function seedInto(doc: Y.Doc, markdown: string): string {
  const { update, seedHash } = buildMinutesSeed(markdown, editor.pmSchema, minutesSchema.styleSchema)
  Y.applyUpdate(doc, update)
  return seedHash
}

/** 器の中身を Markdown に戻す（確認用。本番では生きているエディタから書き出す） */
function readBack(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(MINUTES_FRAGMENT_NAME)
  const root = yXmlFragmentToProseMirrorRootNode(fragment, editor.pmSchema)
  const blocks: unknown[] = []
  root.firstChild?.forEach((child) => {
    blocks.push(
      nodeToBlock(
        child,
        editor.pmSchema,
        minutesSchema.blockSchema,
        minutesSchema.inlineContentSchema,
        minutesSchema.styleSchema
      )
    )
  })
  return serializeMinutesBlocks(blocks as never)
}

const SAMPLE = [
  '# 会議: キックオフ',
  '',
  '## 決定事項',
  '',
  '- 決めたこと',
  '',
  '## 未決事項（タスク化）',
  '',
  '- [ ] SPEC(/spec/REVIEW_SPEC.md#x): 決めること <!--task:11111111-1111-1111-1111-111111111111-->',
].join('\n')

describe('議事録の種まき（決定性）', () => {
  it('同じ本文からは、まったく同じ更新（byte 列）になる', () => {
    const a = buildMinutesSeed(SAMPLE, editor.pmSchema, minutesSchema.styleSchema)
    const b = buildMinutesSeed(SAMPLE, editor.pmSchema, minutesSchema.styleSchema)
    expect(Array.from(a.update)).toEqual(Array.from(b.update))
  })

  it('2人が別々に種をまいて合流しても、本文が二重にならない', () => {
    // 田中と山田が同時に開き、それぞれ列の本文から器を作って交換した、という場面
    const tanaka = new Y.Doc()
    const yamada = new Y.Doc()
    seedInto(tanaka, SAMPLE)
    seedInto(yamada, SAMPLE)

    // 互いの状態をそのまま相手へ流し込む
    Y.applyUpdate(tanaka, Y.encodeStateAsUpdate(yamada))
    Y.applyUpdate(yamada, Y.encodeStateAsUpdate(tanaka))

    expect(readBack(tanaka)).toBe(SAMPLE)
    expect(readBack(yamada)).toBe(SAMPLE)
  })

  it('同じ器に2回まいても二重にならない', () => {
    const doc = new Y.Doc()
    seedInto(doc, SAMPLE)
    seedInto(doc, SAMPLE)
    expect(readBack(doc)).toBe(SAMPLE)
  })

  it('種をまいた器から元の Markdown が戻る', () => {
    const doc = new Y.Doc()
    seedInto(doc, SAMPLE)
    expect(readBack(doc)).toBe(SAMPLE)
  })

  it('空の議事録でも壊れない', () => {
    const doc = new Y.Doc()
    seedInto(doc, '')
    expect(readBack(doc)).toBe('')
  })

  it('本文が違えば種の合言葉（seedHash）も違う', () => {
    expect(minutesSeedHash(SAMPLE)).toBe(minutesSeedHash(SAMPLE))
    expect(minutesSeedHash(SAMPLE)).not.toBe(minutesSeedHash(`${SAMPLE}\n\n- もう1行`))
    // 1文字違いでも別の値になる（近い本文が同じ合言葉にならない）
    expect(minutesSeedHash('あ')).not.toBe(minutesSeedHash('い'))
  })

  it('本文が違う種どうしを合流させたときは、合言葉の違いで気づける', () => {
    const doc = new Y.Doc()
    const first = seedInto(doc, SAMPLE)
    const second = minutesSeedHash(`${SAMPLE}\n\n- 後から足した行`)
    expect(first).not.toBe(second)
  })
})
