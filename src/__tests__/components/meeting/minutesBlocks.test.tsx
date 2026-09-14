// @vitest-environment jsdom
/**
 * 議事録に足した2つのブロック（会議メモ・折りたたみ）を、**本物の BlockNote** に
 * 読み込ませて確かめる。この画面は Markdown が正本なので、大事なのは
 * 「入れたものが、保存して読み直しても同じ形で残る」こと。
 */
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  BlockNoteEditor,
  BlockNoteSchema,
  createInlineContentSpec,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs,
} from '@blocknote/core'
import {
  MEETING_NOTE_TYPE,
  parseMinutesMarkdown,
  serializeMinutesBlocks,
  TASK_MARKER_TYPE,
  TOGGLE_TYPE,
} from '@/lib/minutes/markdown'
import { MeetingNoteBlock, meetingNoteSpec, toggleListItemSpec } from '@/components/meeting/minutesBlocks'

const taskMarkerSpec = createInlineContentSpec(
  {
    type: TASK_MARKER_TYPE,
    propSchema: { taskId: { default: '' } },
    content: 'none',
  } as const,
  { render: () => ({ dom: document.createElement('span') }) }
)

// MinutesEditor.tsx の useMinutesSchema と同じ構成
const minutesSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    table: defaultBlockSpecs.table,
    codeBlock: defaultBlockSpecs.codeBlock,
    [TOGGLE_TYPE]: toggleListItemSpec,
    [MEETING_NOTE_TYPE]: meetingNoteSpec,
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

function roundTrip(md: string): string {
  const editor = BlockNoteEditor.create({
    schema: minutesSchema,
    initialContent: parseMinutesMarkdown(md) as never,
  })
  return serializeMinutesBlocks(editor.document)
}

describe('議事録の折りたたみ', () => {
  it('中身ごと、読み込んで書き出しても同じ形に戻る', () => {
    const md = ['- <!--toggle-->前回の経緯', '  - 値段の話', '  - 納期の話'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('折りたたみの中のチェックと、ふつうの箇条書きが混ざっても壊れない', () => {
    const md = ['- <!--toggle-->前回の経緯', '  - [ ] 値段を決める', '- ふつうの箇条書き'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('BlockNote 側でも折りたたみの種別として読み込まれる', () => {
    const editor = BlockNoteEditor.create({
      schema: minutesSchema,
      initialContent: parseMinutesMarkdown('- <!--toggle-->前回の経緯') as never,
    })
    expect(editor.document[0].type).toBe(TOGGLE_TYPE)
  })

  it('「>」とスペースで折りたたみになる入力ルールを持っている', () => {
    // 既定の折りたたみには入力ルールが無く（「>」は引用ブロック用）、こちらで足している。
    // 消えると Notion と同じ打ち方ができなくなるので、ここで見張る
    const rules = toggleListItemSpec.extensions
      .flatMap((ext) => {
        const resolved = typeof ext === 'function' ? (ext as () => unknown)() : ext
        const inputRules = (resolved as { inputRules?: { find: RegExp }[] }).inputRules
        return inputRules ?? []
      })
      .map((rule) => rule.find.source)
    expect(rules).toContain('^>\\s$')
  })
})

describe('議事録の会議メモ', () => {
  it('読み込んで書き出しても同じ形に戻る', () => {
    const md = ['# 会議', '', '<!--note-->その場で出た補足', '', '- やること'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('BlockNote 側でも会議メモの種別として読み込まれる', () => {
    const editor = BlockNoteEditor.create({
      schema: minutesSchema,
      initialContent: parseMinutesMarkdown('<!--note-->その場で出た補足') as never,
    })
    expect(editor.document[0].type).toBe(MEETING_NOTE_TYPE)
  })

  it('文字を持てる（あとから書き足せる）', () => {
    expect(meetingNoteSpec.config.content).toBe('inline')
  })

  it('書いた日時も読み込んで書き出せる', () => {
    const md = '<!--note:2026-09-15T14:30-->その場で出た補足'
    expect(roundTrip(md)).toBe(md)
  })

  it('BlockNote 側にも書いた日時が残る', () => {
    const editor = BlockNoteEditor.create({
      schema: minutesSchema,
      initialContent: parseMinutesMarkdown('<!--note:2026-09-15T14:30-->補足') as never,
    })
    expect((editor.document[0].props as { createdAt?: string }).createdAt).toBe('2026-09-15T14:30')
  })
})

describe('会議メモの見た目', () => {
  it('書いた日時を小さく添える', () => {
    render(<MeetingNoteBlock createdAt="2026-09-15T14:30" contentRef={() => {}} />)
    const time = screen.getByTestId('minutes-meeting-note-time')
    expect(time).toHaveTextContent('9/15 14:30')
    // 本文と一緒に消してしまわないよう、打てない場所に置く
    expect(time).toHaveAttribute('contenteditable', 'false')
  })

  it('日時が無ければ何も添えない', () => {
    render(<MeetingNoteBlock contentRef={() => {}} />)
    expect(screen.queryByTestId('minutes-meeting-note-time')).not.toBeInTheDocument()
  })

  it('壊れた日時のときも何も添えない', () => {
    render(<MeetingNoteBlock createdAt="こわれた" contentRef={() => {}} />)
    expect(screen.queryByTestId('minutes-meeting-note-time')).not.toBeInTheDocument()
  })
})
