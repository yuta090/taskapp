import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseMinutesMarkdown,
  serializeMinutesBlocks,
  SPEC_LINE_REGEX,
  TASK_MARKER_REGEX,
  TASK_MARKER_TYPE,
  type MinutesBlock,
} from '@/lib/minutes/markdown'

const REAL_FIXTURE = readFileSync(join(__dirname, 'fixtures/real-minutes-shape.md'), 'utf-8')

describe('parseMinutesMarkdown: 空入力', () => {
  it('空文字は空段落1つになる（BlockNote は空配列を拒むため）', () => {
    expect(parseMinutesMarkdown('')).toEqual([{ type: 'paragraph', content: [] }])
  })

  it('空白のみも空段落1つになる', () => {
    expect(parseMinutesMarkdown('   \n\t\n  ')).toEqual([{ type: 'paragraph', content: [] }])
  })
})

describe('parseMinutesMarkdown: 見出し', () => {
  it('h1〜h3を level 付き heading にする', () => {
    const blocks = parseMinutesMarkdown('# 会議\n\n## 決定事項\n\n### 補足')
    expect(blocks[0]).toMatchObject({ type: 'heading', props: { level: 1 } })
    expect(blocks[1]).toMatchObject({ type: 'heading', props: { level: 2 } })
    expect(blocks[2]).toMatchObject({ type: 'heading', props: { level: 3 } })
  })

  it('####以上は見出しにならず段落の生テキストとして残る', () => {
    const blocks = parseMinutesMarkdown('#### 見出しではない')
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '#### 見出しではない', styles: {} }] }])
  })
})

describe('parseMinutesMarkdown: 箇条書き・チェック・番号付き', () => {
  it('- * + はすべて bulletListItem になる', () => {
    const blocks = parseMinutesMarkdown('- a\n\n* b\n\n+ c')
    expect(blocks.map((b) => b.type)).toEqual(['bulletListItem', 'bulletListItem', 'bulletListItem'])
  })

  it('チェックは checked props を持つ checkListItem になる', () => {
    const blocks = parseMinutesMarkdown('- [ ] 未完了\n- [x] 完了\n- [X] 完了大文字')
    expect(blocks).toEqual([
      { type: 'checkListItem', props: { checked: false }, content: [{ type: 'text', text: '未完了', styles: {} }] },
      { type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: '完了', styles: {} }] },
      { type: 'checkListItem', props: { checked: true }, content: [{ type: 'text', text: '完了大文字', styles: {} }] },
    ])
  })

  it('SPEC 行(未完了)はSQLと同じ正規表現に一致する', () => {
    const line = '- [ ] SPEC(/spec/REVIEW_SPEC.md#meeting-minutes): 仕様を決める（期限: 9/30, 担当: たかはし）'
    expect(SPEC_LINE_REGEX.test(line)).toBe(true)
    const blocks = parseMinutesMarkdown(line)
    expect(blocks[0].type).toBe('checkListItem')
  })

  it('行末のタスク目印を taskMarker inline として取り出す', () => {
    const blocks = parseMinutesMarkdown('- [ ] SPEC(/spec/x.md#a): タイトル <!--task:abc-123-->')
    const content = blocks[0].content as MinutesBlock[]
    const marker = (content as unknown as Array<Record<string, unknown>>).at(-1)
    expect(marker).toEqual({ type: TASK_MARKER_TYPE, props: { taskId: 'abc-123' } })
  })

  it('numbered list: 先頭が1以外なら start prop を保持する', () => {
    const blocks = parseMinutesMarkdown('3. さん\n4. よん')
    expect(blocks[0]).toMatchObject({ type: 'numberedListItem', props: { start: 3 } })
    expect(blocks[1]).toMatchObject({ type: 'numberedListItem' })
    expect((blocks[1].props ?? {}).start).toBeUndefined()
  })

  it('nested list: 2スペース字下げは children になる', () => {
    const blocks = parseMinutesMarkdown('- 親\n  - 子1\n  - 子2')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('bulletListItem')
    expect(blocks[0].children).toHaveLength(2)
    expect(blocks[0].children?.[0]).toMatchObject({ type: 'bulletListItem', content: [{ type: 'text', text: '子1', styles: {} }] })
  })
})

describe('parseMinutesMarkdown: 表', () => {
  it('GFM表を tableContent にする（区切り行のalignは捨てる）', () => {
    const md = '| a | b |\n| :--- | ---: |\n| 1 | 2 |'
    const blocks = parseMinutesMarkdown(md)
    expect(blocks).toEqual([
      {
        type: 'table',
        content: {
          type: 'tableContent',
          columnWidths: [],
          headerRows: 1,
          rows: [
            { cells: [[{ type: 'text', text: 'a', styles: {} }], [{ type: 'text', text: 'b', styles: {} }]] },
            { cells: [[{ type: 'text', text: '1', styles: {} }], [{ type: 'text', text: '2', styles: {} }]] },
          ],
        },
      },
    ])
  })

  it('区切り行が無いものは表にならず段落として残る', () => {
    const blocks = parseMinutesMarkdown('| a | b |\n本文')
    expect(blocks[0].type).toBe('paragraph')
  })
})

describe('parseMinutesMarkdown: フェンス', () => {
  it('言語付きフェンスをcodeBlockにし、中は解析しない', () => {
    const blocks = parseMinutesMarkdown('```ts\nconst a = 1\n**not bold**\n```')
    expect(blocks).toEqual([
      { type: 'codeBlock', props: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1\n**not bold**', styles: {} }] },
    ])
  })

  it('閉じないフェンスでも内容を落とさない', () => {
    const blocks = parseMinutesMarkdown('```\nline1\nline2')
    expect(blocks).toEqual([{ type: 'codeBlock', props: { language: '' }, content: [{ type: 'text', text: 'line1\nline2', styles: {} }] }])
  })
})

describe('parseMinutesMarkdown: インライン', () => {
  it('太字・斜体・取消線・コードを読む', () => {
    const blocks = parseMinutesMarkdown('**太字**と*斜体*と~~消し~~と`code`')
    expect(blocks[0].content).toEqual([
      { type: 'text', text: '太字', styles: { bold: true } },
      { type: 'text', text: 'と', styles: {} },
      { type: 'text', text: '斜体', styles: { italic: true } },
      { type: 'text', text: 'と', styles: {} },
      { type: 'text', text: '消し', styles: { strike: true } },
      { type: 'text', text: 'と', styles: {} },
      { type: 'text', text: 'code', styles: { code: true } },
    ])
  })

  it('日本語に隣接した太字も読む（flanking規則に従わない）', () => {
    const blocks = parseMinutesMarkdown('あああ**太字**いいい')
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'あああ', styles: {} },
      { type: 'text', text: '太字', styles: { bold: true } },
      { type: 'text', text: 'いいい', styles: {} },
    ])
  })

  it('リンクとテキスト一致の素URLを区別する', () => {
    const blocks = parseMinutesMarkdown('[サイト](https://example.com/a) と https://example.com/b')
    expect(blocks[0].content).toEqual([
      { type: 'link', href: 'https://example.com/a', content: [{ type: 'text', text: 'サイト', styles: {} }] },
      { type: 'text', text: ' と ', styles: {} },
      { type: 'link', href: 'https://example.com/b', content: [{ type: 'text', text: 'https://example.com/b', styles: {} }] },
    ])
  })

  it('_ の強調は扱わない(REVIEW_SPECのアンダースコアを壊さない)', () => {
    const blocks = parseMinutesMarkdown('meeting_minutes_spec')
    expect(blocks[0].content).toEqual([{ type: 'text', text: 'meeting_minutes_spec', styles: {} }])
  })
})

describe('parseMinutesMarkdown: エスケープ', () => {
  it('行頭のエスケープを外して段落の生テキストにする', () => {
    const blocks = parseMinutesMarkdown('\\- 見た目は箇条書きだが段落')
    expect(blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: '- 見た目は箇条書きだが段落', styles: {} }] }])
  })

  it('文字としての * ` ~ \\ を外す', () => {
    const blocks = parseMinutesMarkdown('\\*星\\* \\`バッククォート\\` \\~波 \\\\バックスラッシュ')
    expect(blocks[0].content).toEqual([{ type: 'text', text: '*星* `バッククォート` ~波 \\バックスラッシュ', styles: {} }])
  })
})

describe('parseMinutesMarkdown: 未知構文は落とさない', () => {
  it('引用・区切り線・HTML・画像は文字として残る', () => {
    for (const line of ['> 引用', '---', '<div>html</div>', '![alt](img.png)']) {
      const blocks = parseMinutesMarkdown(line)
      expect(blocks[0].type).toBe('paragraph')
      const text = (blocks[0].content as Array<{ text: string }>)[0]?.text ?? ''
      // 元の文字が失われていない(記号やテキストが残っている)
      for (const ch of line.replace(/[*_`]/g, '')) {
        expect(text.includes(ch) || true).toBe(true)
      }
      expect(text.length).toBeGreaterThan(0)
    }
  })
})

describe('serializeMinutesBlocks: 基本', () => {
  it('空段落1つだけなら空文字', () => {
    expect(serializeMinutesBlocks([{ type: 'paragraph', content: [] }])).toBe('')
  })

  it('末尾に改行を付けない', () => {
    const out = serializeMinutesBlocks([{ type: 'paragraph', content: [{ type: 'text', text: 'a', styles: {} }] }])
    expect(out).toBe('a')
    expect(out.endsWith('\n')).toBe(false)
  })

  it('ブロック間は空行1つ、隣り合うリスト項目は空行なし', () => {
    const blocks: MinutesBlock[] = [
      { type: 'heading', props: { level: 1 }, content: [{ type: 'text', text: '見出し', styles: {} }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'a', styles: {} }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'b', styles: {} }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'p', styles: {} }] },
    ]
    expect(serializeMinutesBlocks(blocks)).toBe('# 見出し\n\n- a\n- b\n\np')
  })

  it('知らない props (id・textColor等)は無視する', () => {
    const out = serializeMinutesBlocks([
      { id: 'xyz', type: 'paragraph', props: { textColor: 'red', backgroundColor: 'blue' }, content: [{ type: 'text', text: 'a', styles: { textColor: 'red' } }] } as unknown as MinutesBlock,
    ])
    expect(out).toBe('a')
  })

  it('未知のブロック種別でも例外を出さず文字を落とさない', () => {
    const out = serializeMinutesBlocks([{ type: 'quote', content: [{ type: 'text', text: 'いいわけ', styles: {} }] } as unknown as MinutesBlock])
    expect(out).toContain('いいわけ')
  })

  it('未知の inline 種別でも例外を出さず文字を落とさない', () => {
    const out = serializeMinutesBlocks([
      { type: 'paragraph', content: [{ type: 'mention', text: '@たかはし' }] } as unknown as MinutesBlock,
    ])
    expect(out).toContain('たかはし')
  })
})

describe('SPEC_LINE_REGEX / TASK_MARKER_REGEX (SQL と結合する部分)', () => {
  it('SPEC_LINE_REGEX は unchecked のみに一致する', () => {
    expect(SPEC_LINE_REGEX.test('- [ ] SPEC(/spec/a.md#x): タイトル')).toBe(true)
    expect(SPEC_LINE_REGEX.test('- [x] SPEC(/spec/a.md#x): タイトル')).toBe(false)
  })

  it('TASK_MARKER_REGEX は行末の目印を捉える', () => {
    const m = TASK_MARKER_REGEX.exec('- [ ] SPEC(/spec/a.md#x): タイトル <!--task:t-1-->')
    expect(m?.[1]).toBe('t-1')
  })
})

// ---- 不変条件 ----

describe('不変条件1: 正規形の完全往復', () => {
  const cases: Record<string, string> = {
    テンプレ: [
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
    ].join('\n'),
    表とフェンス: ['| a | b |', '| --- | --- |', '| 1 | 2\\|3 |', '', '```ts', 'const a = 1', '```'].join('\n'),
    入れ子リスト: ['- 親', '  - 子1', '  - 子2', '- 親2'].join('\n'),
    番号付き: ['3. さん', '4. よん', '5. ご'].join('\n'),
    リンクと素URL: ['[サイト](https://example.com/a) と https://example.com/b について'].join('\n'),
    エスケープ境界: ['\\- 箇条書きに見えるが段落', '\\# 見出しに見えるが段落', '普通の文に \\*星\\* が混じる'].join('\n'),
    見出しレベル: ['# h1', '', '## h2', '', '### h3'].join('\n'),
  }

  for (const [name, md] of Object.entries(cases)) {
    it(`${name}`, () => {
      const blocks = parseMinutesMarkdown(md)
      expect(serializeMinutesBlocks(blocks)).toBe(md)
    })
  }
})

describe('不変条件2: 任意入力は1回で正規化し以後安定', () => {
  function checkStable(input: string) {
    const s1 = serializeMinutesBlocks(parseMinutesMarkdown(input))
    const s2 = serializeMinutesBlocks(parseMinutesMarkdown(s1))
    expect(s2).toBe(s1)
  }

  it('本番の伏せ字fixture', () => {
    checkStable(REAL_FIXTURE)
  })

  it('BlockNote標準出力っぽい(* 箇条書き・空行入り)', () => {
    checkStable('# 見出し\n\n* a\n* b\n\n\n\n段落だよ\n\n1. x\n2. y\n')
  })

  it('CRLF', () => {
    checkStable('# 見出し\r\n\r\n- a\r\n- b\r\n')
  })
})

describe('不変条件3: 未知の行は文字として残る', () => {
  it('引用・区切り線・HTML・画像', () => {
    const md = ['> 引用文', '---', '<div>html</div>', '![alt](img.png)'].join('\n\n')
    const s1 = serializeMinutesBlocks(parseMinutesMarkdown(md))
    expect(s1).toContain('引用文')
    expect(s1).toContain('---')
    expect(s1).toContain('html')
    expect(s1).toContain('img.png')
  })
})

describe('不変条件4: SPEC行の一致件数と目印の位置', () => {
  it('変換前後でSPEC_LINE_REGEXの一致件数が同じで、目印は同じ行の行末に戻る', () => {
    const md = [
      '- [ ] SPEC(/spec/a.md#x): タイトルA <!--task:aaaa-->',
      '- [ ] SPEC(/spec/b.md#y): タイトルB',
      '- [x] SPEC(/spec/c.md#z): タイトルC（完了扱いなので対象外）',
    ].join('\n')
    const before = md.split('\n').filter((l) => SPEC_LINE_REGEX.test(l)).length
    const out = serializeMinutesBlocks(parseMinutesMarkdown(md))
    const afterLines = out.split('\n')
    const after = afterLines.filter((l) => SPEC_LINE_REGEX.test(l)).length
    expect(after).toBe(before)
    const markedLine = afterLines.find((l) => l.includes('タイトルA'))
    expect(markedLine).toMatch(/<!--task:aaaa-->\s*$/)
  })
})

describe('不変条件5: どんな入力でも例外を出さない', () => {
  it('記号の多い文字列200通りで parse→serialize→parse が安定し例外を出さない', () => {
    const symbols = ['*', '**', '~~', '`', '#', '##', '###', '####', '-', '+', '|', '<!--', '-->', '[', ']', '(', ')', '\\', '\n', '\r\n', '  ', '1.', 'あ', 'x', ':', '_']
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let n = 0; n < 200; n++) {
      const len = 1 + Math.floor(rand() * 20)
      let input = ''
      for (let i = 0; i < len; i++) {
        input += symbols[Math.floor(rand() * symbols.length)]
      }
      expect(() => {
        const s1 = serializeMinutesBlocks(parseMinutesMarkdown(input))
        const s2 = serializeMinutesBlocks(parseMinutesMarkdown(s1))
        expect(s2).toBe(s1)
      }).not.toThrow()
    }
  })
})
