// @vitest-environment jsdom
/**
 * M5: 「開いただけで保存 0 回」の歯止め(MinutesDocumentView)は、BlockNote が初期表示
 * 直後に normalize 済みの内容で onChange を呼んできても、正規化済みの基準と一致する
 * という前提に立つ。本物の BlockNote(画面なし)にMinutesEditorと同じ形のスキーマで
 * 議事録らしい本文を読み込ませ、serialize(editor.document) が基準(=読み込ませた本文
 * そのもの)と一致することを確かめる（markdown.blocknote.test.ts と同じ作り方）。
 */
import { describe, expect, it } from 'vitest'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import { parseMinutesMarkdown, serializeMinutesBlocks, TASK_MARKER_TYPE } from '@/lib/minutes/markdown'

// MinutesEditor.tsx の useMinutesSchema と同じ構成（taskMarker の render だけ、
// React コンポーネントではなく最小のスタブに置き換えている）
const taskMarkerSpec = createInlineContentSpec(
  {
    type: TASK_MARKER_TYPE,
    propSchema: { taskId: { default: '' } },
    content: 'none',
  } as const,
  {
    render: () => {
      const dom = document.createElement('span')
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

function openInRealEditor(md: string): string {
  const blocks = parseMinutesMarkdown(md)
  const editor = BlockNoteEditor.create({ schema: minutesSchema, initialContent: blocks as never })
  return serializeMinutesBlocks(editor.document)
}

describe('MinutesEditor のスキーマで実際の BlockNote に読み込ませても、基準と一致する', () => {
  it('議事録らしい本文（見出し・決定事項・タスク化候補）を読み込ませても、そのまま同じ本文に戻る', () => {
    const md = [
      '# 会議: キックオフ',
      '',
      '日時: 2026/09/12 10:00',
      '',
      '## 決定事項',
      '',
      '- 決定した内容',
      '',
      '## 未決事項（タスク化）',
      '',
      '- [ ] SPEC(/spec/REVIEW_SPEC.md#a): 仕様として決めること（期限: 9/30, 担当: たかはし）',
    ].join('\n')

    // 「開いただけで保存 0 回」の歯止めが比較する基準と同じ計算をしている
    const baseline = serializeMinutesBlocks(parseMinutesMarkdown(md))
    expect(openInRealEditor(md)).toBe(baseline)
    expect(baseline).toBe(md)
  })
})
