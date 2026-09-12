// @vitest-environment jsdom
/**
 * markdown.ts の変換結果を、実際の BlockNote エディタ(@blocknote/core)に
 * 食わせて確認する。markdown.ts 本体は BlockNote を import しないが、この
 * テストでは「BlockNote が実際に受け付けるか」を確かめる。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
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

  it('本番の伏せ字fixtureも例外を出さずBlockNoteへ読み込め、そこから先は安定する', () => {
    // 実データの形(見出し・表・箇条書き・太字・入れ子)を BlockNote に一度通しても
    // 例外を出さないこと、かつ BlockNote が返した document をもう一度書き出しても
    // 変わらない(1回の正規化後は安定する)ことを確認する。
    const REAL_FIXTURE = readFileSync(join(__dirname, 'fixtures/real-minutes-shape.md'), 'utf-8')
    let s1 = ''
    expect(() => {
      s1 = roundTripThroughBlockNote(REAL_FIXTURE)
    }).not.toThrow()
    const s2 = roundTripThroughBlockNote(s1)
    expect(s2).toBe(s1)
  })

  it('空段落だけの議事録も読み込める', () => {
    const blocks: MinutesBlock[] = parseMinutesMarkdown('')
    const editor = BlockNoteEditor.create({ schema: minutesSchema, initialContent: blocks as never })
    expect(serializeMinutesBlocks(editor.document)).toBe('')
  })

  it('HIGH-1: SPEC項目に Shift+Enter で補足を書いても目印は1行目に残る(実機)', () => {
    const blocks: MinutesBlock[] = [
      {
        type: 'checkListItem',
        props: { checked: false },
        content: [{ type: 'text', text: 'SPEC(/spec/a.md#x): タイトル', styles: {} }, { type: TASK_MARKER_TYPE, props: { taskId: 'aaaa' } }],
      },
    ]
    const editor = BlockNoteEditor.create({ schema: minutesSchema, initialContent: blocks as never })
    editor.setTextCursorPosition(editor.document[0], 'end')
    editor.insertInlineContent(['\n補足メモ'] as never)
    const out = serializeMinutesBlocks(editor.document)
    const lines = out.split('\n')
    expect(lines[0]).toBe('- [ ] SPEC(/spec/a.md#x): タイトル <!--task:aaaa-->')
    expect(lines[1]).not.toMatch(/<!--task:/)
  })
})
