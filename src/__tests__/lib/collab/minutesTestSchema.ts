/**
 * 同時編集のテストで使う、議事録スキーマの代役。
 *
 * 本物（`useMinutesSchema`）は React の部品を使うので、ここでは同じブロック構成の
 * React 非依存版を作る。種まき・合流の確かめに必要なのは pmSchema の形だけ。
 */
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
  nodeToBlock,
} from '@blocknote/core'
import { blockToNode } from '@blocknote/core'
import { updateYFragment, yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror'
import type * as Y from 'yjs'
import { parseMinutesMarkdown, serializeMinutesBlocks, TASK_MARKER_TYPE } from '@/lib/minutes/markdown'
import { seedMinutesDoc } from '@/lib/collab/seed'
import { MINUTES_FRAGMENT_NAME } from '@/lib/collab/hash'

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

export const minutesTestSchema = BlockNoteSchema.create({
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
export const schemaProbe = BlockNoteEditor.create({ schema: minutesTestSchema })

/**
 * 本文から種をまく（`seed` オプションに渡す形）。
 * `basis` は、その本文を読んだときの列の更新時刻。種が2つ入ったときに
 * **どちらが新しいか**を決めるのに使う。
 */
export function seedWith(markdown: string, basis: string | null = null) {
  return (doc: Y.Doc): { seedHash: string; basis: string | null } => ({
    seedHash: seedMinutesDoc(doc, markdown, schemaProbe.pmSchema, minutesTestSchema.styleSchema),
    basis,
  })
}

/** 器の直下にある本文のかたまりの数。2つ以上なら本文が二重になっている */
export function blockGroupCount(doc: Y.Doc): number {
  return doc.getXmlFragment(MINUTES_FRAGMENT_NAME).length
}

/**
 * 「打った」ことにする。本物のエディタが使うのと同じ `updateYFragment` を通すので、
 * 既にある部分は残り、変わった分だけの更新になる（本物の編集と同じ形）。
 */
export function applyMarkdown(doc: Y.Doc, markdown: string): void {
  const blocks = (parseMinutesMarkdown(markdown) as { id?: string }[]).map((block, index) => ({
    ...block,
    id: block.id ?? `line-${index}`,
  }))
  const node = schemaProbe.pmSchema.nodeFromJSON({
    type: 'doc',
    content: [
      {
        type: 'blockGroup',
        content: blocks.map((block) =>
          blockToNode(block as never, schemaProbe.pmSchema, minutesTestSchema.styleSchema).toJSON()
        ),
      },
    ],
  })
  const fragment = doc.getXmlFragment(MINUTES_FRAGMENT_NAME)
  doc.transact(() => {
    updateYFragment(doc, fragment, node as never, { mapping: new Map(), isOMark: new Map() } as never)
  })
}

/** 器の中身を Markdown に戻す（確かめ用。本番は生きているエディタから書き出す） */
export function readBackMarkdown(doc: Y.Doc): string {
  const fragment = doc.getXmlFragment(MINUTES_FRAGMENT_NAME)
  const root = yXmlFragmentToProseMirrorRootNode(fragment, schemaProbe.pmSchema)
  const blocks: unknown[] = []
  root.firstChild?.forEach((child) => {
    blocks.push(
      nodeToBlock(
        child,
        schemaProbe.pmSchema,
        minutesTestSchema.blockSchema,
        minutesTestSchema.inlineContentSchema,
        minutesTestSchema.styleSchema
      )
    )
  })
  return serializeMinutesBlocks(blocks as never)
}
