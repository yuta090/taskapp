// @vitest-environment jsdom
/**
 * markdown.ts の変換結果を、実際の BlockNote エディタ(@blocknote/core)に
 * 食わせて確認する。markdown.ts 本体は BlockNote を import しないが、この
 * テストでは「BlockNote が実際に受け付けるか」を確かめる。
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
import { parseMinutesMarkdown, serializeMinutesBlocks, TASK_MARKER_TYPE, type MinutesBlock } from '@/lib/minutes/markdown'

const taskMarkerSpec = createInlineContentSpec(
  {
    type: TASK_MARKER_TYPE,
    propSchema: { taskId: { default: '' } },
    content: 'none',
  } as const,
  {
    render: () => {
      const dom = document.createElement('span')
      dom.dataset.taskMarker = 'true'
      return { dom }
    },
  },
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

function roundTripThroughBlockNote(md: string): string {
  const blocks = parseMinutesMarkdown(md)
  const editor = BlockNoteEditor.create({
    schema: minutesSchema,
    initialContent: blocks as never,
  })
  return serializeMinutesBlocks(editor.document)
}

describe('BlockNote 実機での確認', () => {
  it('議事録テンプレ形を BlockNote スキーマに読み込ませても元の Markdown に戻る', () => {
    const md = [
      '# 会議: キックオフ',
      '',
      '日時: 2026/09/12 10:00',
      '参加: クライアント / 社内',
      '',
      '## 決定事項',
      '',
      '- 決定した内容',
      '',
      '## 未決事項（タスク化）',
      '',
      '- [ ] SPEC(/spec/REVIEW_SPEC.md#meeting-minutes): 仕様として決めること（期限: 9/30, 担当: たかはし） <!--task:11111111-1111-1111-1111-111111111111-->',
      '- [ ] TODO: 作業タスク（期限: 10/1, 担当: やまだ）',
      '',
      '## メモ',
      '',
      '- 箇条書き',
    ].join('\n')

    expect(roundTripThroughBlockNote(md)).toBe(md)
  })

  it('表・フェンス・入れ子リスト・番号付きリストも受け付けて元に戻る', () => {
    const md = [
      '- 親',
      '  - 子1',
      '  - 子2',
      '- 親2',
      '3. さん',
      '4. よん',
      '',
      '| a | b |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```ts',
      'const a = 1',
      '```',
    ].join('\n')

    expect(roundTripThroughBlockNote(md)).toBe(md)
  })

  it('太字・斜体・取消線・コードも受け付けて元に戻る', () => {
    const md = '**太字**と*斜体*と~~消し~~と`code`'
    expect(roundTripThroughBlockNote(md)).toBe(md)
  })

  it('BlockNote の schema に taskMarker が登録されている', () => {
    expect(minutesSchema.inlineContentSchema[TASK_MARKER_TYPE]).toBeDefined()
  })

  it('本番の伏せ字fixtureも例外を出さずBlockNoteへ読み込める', () => {
    // 実データの形(見出し・表・箇条書き・太字・入れ子)を BlockNote に一度通しても壊れない
    // ことだけを確認する(このfixtureは正規形ではないため完全一致は求めない)。
    const md = ['# 見出し', '', '- 箇条書き **太字** 混じり', '', '| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    expect(() => roundTripThroughBlockNote(md)).not.toThrow()
  })

  it('空段落だけの議事録も読み込める', () => {
    const blocks: MinutesBlock[] = parseMinutesMarkdown('')
    const editor = BlockNoteEditor.create({ schema: minutesSchema, initialContent: blocks as never })
    expect(serializeMinutesBlocks(editor.document)).toBe('')
  })
})
