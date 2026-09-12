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

const t = (text: string, styles: Record<string, boolean> = {}) => ({ type: 'text' as const, text, styles })
const mk = (id: string) => ({ type: TASK_MARKER_TYPE, props: { taskId: id } })

/** SQL 側(最新マイグレーション)から SPEC_LINE_REGEX / TASK_MARKER_REGEX 相当の
 * パターンをそのまま切り出し、TS 側の定数と文字列として一致することを確認する。 */
function extractSqlPattern(sql: string, label: string): string {
  const re = new RegExp(`${label} ~ '([^']+)'`)
  const m = re.exec(sql)
  if (!m) throw new Error(`${label} のパターンが見つかりません`)
  return m[1]
}

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
  it('引用・区切り線・HTML・画像は文字として残る(元の文字列がそのまま残る)', () => {
    for (const line of ['> 引用', '---', '<div>html</div>', '![alt](img.png)']) {
      const blocks = parseMinutesMarkdown(line)
      expect(blocks[0].type).toBe('paragraph')
      const text = (blocks[0].content as Array<{ text: string }>)[0]?.text ?? ''
      expect(text).toBe(line)
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
  it('記号の多い文字列300通りで parse→serialize→parse が安定し例外を出さない', () => {
    const symbols = [
      '*', '**', '***', '~~', '`', '```', '#', '##', '###', '####', '-', '+', '|', '<!--', '-->', '[', ']', '(', ')',
      '\\', '\n', '\r\n', '  ', '1.', 'あ', 'x', ':', '_', 'http://a', 'https://b', '[a](b)',
    ]
    let seed = 42
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let n = 0; n < 300; n++) {
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

describe('不変条件6: SQL(最新マイグレーション)の正規表現とTS側の定数が一致する', () => {
  it('rpc_parse_meeting_minutes の SPEC_LINE_REGEX / TASK_MARKER_REGEX と文字列一致する', () => {
    const sql = readFileSync(join(__dirname, '../../../../supabase/migrations/20260911143112_space_role_boundary.sql'), 'utf-8')
    const specPattern = extractSqlPattern(sql, 'v_line')
    expect(specPattern).toBe(SPEC_LINE_REGEX.source)
    // 目印の取り出し(substring)は「末尾アンカー無し」でTS側の捕捉グループ部分と一致する
    const extractMatches = [...sql.matchAll(/substring\(v_line from '(<!--task:\([^']+)'\)/g)]
    expect(extractMatches.length).toBeGreaterThan(0)
    const withoutAnchor = TASK_MARKER_REGEX.source.replace(/\\s\*\$$/, '')
    for (const m of extractMatches) expect(m[1]).toBe(withoutAnchor)
    // 有無だけを見る v_has_marker はTS側から捕捉グループを外した形と一致する
    const hasMarkerMatches = [...sql.matchAll(/v_has_marker := v_line ~ '([^']+)'/g)]
    expect(hasMarkerMatches.length).toBeGreaterThan(0)
    const withoutGroup = TASK_MARKER_REGEX.source.replace('([^>]+)', '[^>]+')
    for (const m of hasMarkerMatches) expect(m[1]).toBe(withoutGroup)
  })
})

// ---- HIGH-1: 目印は最初の行の行末に正規化する ----

describe('HIGH-1: タスク目印は最初の行の行末だけに書く/読む', () => {
  it('Shift+Enterで補足を足しても目印は1行目に残る(SPEC作成済み項目への追記を再現)', () => {
    const blocks: MinutesBlock[] = [
      { type: 'checkListItem', props: { checked: false }, content: [t('SPEC(/spec/a.md#x): タイトル'), t('\n補足メモ'), mk('aaaa-1111')] },
    ]
    const out = serializeMinutesBlocks(blocks)
    const lines = out.split('\n')
    expect(lines[0]).toBe('- [ ] SPEC(/spec/a.md#x): タイトル <!--task:aaaa-1111-->')
    // SPEC_LINE_REGEX は行の形だけを見る(目印の有無は関係ない)。DB は
    // これと TASK_MARKER_REGEX を組み合わせて「未処理か」を判定する。
    expect(SPEC_LINE_REGEX.test(lines[0])).toBe(true)
    expect(TASK_MARKER_REGEX.test(lines[0])).toBe(true) // 目印が付いているので「未処理」ではない
    expect(lines[1]).not.toMatch(/<!--task:/)
    // 安定していること(もう一度読み直しても同じ)
    expect(serializeMinutesBlocks(parseMinutesMarkdown(out))).toBe(out)
  })

  it('目印が content 配列の途中にあっても最初の行の行末に正規化する', () => {
    const blocks: MinutesBlock[] = [
      { type: 'checkListItem', props: { checked: false }, content: [t('SPEC(/spec/a.md#x): A'), mk('m1'), t('\n続き')] },
    ]
    const out = serializeMinutesBlocks(blocks)
    expect(out.split('\n')[0]).toBe('- [ ] SPEC(/spec/a.md#x): A <!--task:m1-->')
  })

  it('見出し・段落でも目印は最初の行の行末から拾う', () => {
    const blocks = parseMinutesMarkdown('メモ本文\n続き行 <!--task:abc-->')
    // 1行目には無いので、目印はこの段落全体としては「2行目」に付いているが、
    // parse は最初の行(メモ本文)にしか目印を探さないため、この文字列はそのまま残る。
    const text = (blocks[0].content as unknown as Array<Record<string, unknown>>).find((c) => c.type === 'text') as { text: string }
    expect(text.text).toContain('<!--task:abc-->')
  })
})

// ---- HIGH-2: SPEC 項目は入れ子にあっても常に最上位に出す(方式b) ----

describe('HIGH-2: 入れ子の中の SPEC 項目は最上位に、段落/見出しの子は字下げしない', () => {
  it('段落の子(Tabで作ったSPEC)は最上位のSPEC行になりSQL正規表現に一致する', () => {
    const blocks: MinutesBlock[] = [
      { type: 'paragraph', content: [t('議題A')], children: [{ type: 'checkListItem', props: { checked: false }, content: [t('SPEC(/spec/a.md#x): 決める'), mk('m1')] }] },
    ]
    const out = serializeMinutesBlocks(blocks)
    const specLine = out.split('\n').find((l) => l.includes('SPEC('))
    expect(specLine).toBeDefined()
    expect(specLine).not.toMatch(/^\s/) // 字下げされていない
    expect(SPEC_LINE_REGEX.test(specLine!.replace(/ <!--task:m1-->$/, ''))).toBe(true)
    expect(serializeMinutesBlocks(parseMinutesMarkdown(out))).toBe(out)
  })

  it('箇条書きの子のSPECも最上位になる', () => {
    const blocks: MinutesBlock[] = [
      { type: 'bulletListItem', content: [t('議題A')], children: [{ type: 'checkListItem', props: { checked: false }, content: [t('SPEC(/spec/a.md#x): 決める')] }] },
    ]
    const out = serializeMinutesBlocks(blocks)
    const specLine = out.split('\n').find((l) => l.includes('SPEC('))!
    expect(specLine.startsWith('- [ ] SPEC(')).toBe(true)
    expect(SPEC_LINE_REGEX.test(specLine)).toBe(true)
  })

  it('見出しの子(通常の段落)は字下げせず、`\\` の付いた段落に化けない', () => {
    const blocks: MinutesBlock[] = [{ type: 'bulletListItem', content: [t('a')], children: [{ type: 'heading', props: { level: 2 }, content: [t('h')] }] }]
    const out = serializeMinutesBlocks(blocks)
    expect(out).toBe('- a\n\n## h')
  })
})

// ---- HIGH-3: 太字+斜体は *** でまとめて開閉し、幅ゼロ文字は増え続けない ----

describe('HIGH-3: ***太字斜体***と幅ゼロ文字', () => {
  it('AI流の ***text*** を太字+斜体として読む', () => {
    const blocks = parseMinutesMarkdown('***重要***の件')
    expect(blocks[0].content).toEqual([
      { type: 'text', text: '重要', styles: { bold: true, italic: true } },
      { type: 'text', text: 'の件', styles: {} },
    ])
  })

  it('太字+斜体は *** でまとめて開閉する', () => {
    const out = serializeMinutesBlocks([{ type: 'paragraph', content: [t('前'), t('重要', { bold: true, italic: true }), t('後')] }])
    expect(out).toBe('前***重要***後')
  })

  it('選択範囲の斜体を繰り返し付け外ししても幅ゼロ文字が増え続けない', () => {
    let doc: MinutesBlock[] = [{ type: 'paragraph', content: [t('前'), t('重要', { bold: true, italic: true }), t('後')] }]
    for (let cycle = 0; cycle < 6; cycle++) {
      const md = serializeMinutesBlocks(doc)
      const zwCount = (md.match(/\u200B/g) ?? []).length
      expect(zwCount).toBe(0)
      doc = parseMinutesMarkdown(md)
      const content = doc[0].content as unknown as Array<Record<string, unknown>>
      const boldTokens = content.filter((c) => c.type === 'text' && (c.styles as Record<string, boolean>).bold)
      const allItalic = boldTokens.every((c) => (c.styles as Record<string, boolean>).italic)
      doc = [
        {
          type: 'paragraph',
          content: content.map((c) =>
            c.type === 'text' && (c.styles as Record<string, boolean>).bold
              ? { ...c, styles: { ...(c.styles as Record<string, boolean>), italic: !allItalic } }
              : c,
          ) as unknown as MinutesBlock['content'],
        },
      ]
    }
  })
})

// ---- 危険な href は link にしない(セキュリティ) ----

describe('セキュリティ: 危険な scheme の href は link にせず文字として残す', () => {
  const dangerous = [
    '[click](javascript:alert(1))',
    '[click](JaVaScRiPt:alert(1))',
    '[click]( \tjavascript:alert(1))',
    '[click](data:text/html,<script>alert(1)</script>)',
    '[click](vbscript:msgbox(1))',
  ]
  for (const md of dangerous) {
    it(`${md} は link にならず文字が残り安定する`, () => {
      const blocks = parseMinutesMarkdown(md)
      expect(blocks[0].content).toEqual([{ type: 'text', text: md, styles: {} }])
      const s1 = serializeMinutesBlocks(blocks)
      expect(s1).toBe(md)
      expect(serializeMinutesBlocks(parseMinutesMarkdown(s1))).toBe(s1)
    })
  }

  const safe: Array<[string, string]> = [
    ['[ok](https://example.com)', 'https://example.com'],
    ['[ok](mailto:a@b.com)', 'mailto:a@b.com'],
    ['[ok](/relative/path)', '/relative/path'],
    ['[ok](#frag)', '#frag'],
  ]
  for (const [md, href] of safe) {
    it(`${md} は安全なので link になる`, () => {
      const blocks = parseMinutesMarkdown(md)
      expect(blocks[0].content).toEqual([{ type: 'link', href, content: [{ type: 'text', text: 'ok', styles: {} }] }])
    })
  }
})

// ---- MEDIUM: 過剰エスケープの是正 ----

describe('MEDIUM-4/5: 不要なエスケープをしない', () => {
  it('単独の ~ や \\ はそのまま(10:00~11:00 / C:\\Users\\taro)', () => {
    const md = '10:00~11:00 に C:\\Users\\taro を確認'
    const blocks = parseMinutesMarkdown(md)
    expect(blocks[0].content).toEqual([{ type: 'text', text: md, styles: {} }])
    expect(serializeMinutesBlocks(blocks)).toBe(md)
  })

  it('行頭の文字「* 注: 」＋斜体「重要」が安定する(文字の逃がしと行の逃がしを区別する)', () => {
    const blocks: MinutesBlock[] = [{ type: 'paragraph', content: [t('* 注: '), t('重要', { italic: true })] }]
    const s1 = serializeMinutesBlocks(blocks)
    const s2 = serializeMinutesBlocks(parseMinutesMarkdown(s1))
    expect(s2).toBe(s1)
    expect(parseMinutesMarkdown(s1)[0].content).toEqual([
      { type: 'text', text: '* 注: ', styles: {} },
      { type: 'text', text: '重要', styles: { italic: true } },
    ])
  })
})

describe('MEDIUM-6: コード表記の中の \\ は普通の文字', () => {
  it('コード末尾が \\ で終わっても閉じを見失わない', () => {
    const md = 'パスは `C:\\work\\` です'
    const blocks = parseMinutesMarkdown(md)
    expect(blocks[0].content).toEqual([
      { type: 'text', text: 'パスは ', styles: {} },
      { type: 'text', text: 'C:\\work\\', styles: { code: true } },
      { type: 'text', text: ' です', styles: {} },
    ])
    expect(serializeMinutesBlocks(blocks)).toBe(md)
  })
})

describe('MEDIUM-7/8: リンク文字の中はURL自動認識オフ、素のURLは日本語/記号で打ち切る', () => {
  it('リンク文字がURLでも自動リンク化しない', () => {
    const md = '[https://a.example.com](https://b.example.com/x)'
    const blocks = parseMinutesMarkdown(md)
    expect(blocks[0].content).toEqual([
      { type: 'link', href: 'https://b.example.com/x', content: [{ type: 'text', text: 'https://a.example.com', styles: {} }] },
    ])
    expect(serializeMinutesBlocks(blocks)).toBe(md)
  })

  it('リンク文字にURLを含む文でも自動リンク化しない', () => {
    const md = '[資料 https://a.example.com](https://b.example.com/x)'
    expect(serializeMinutesBlocks(parseMinutesMarkdown(md))).toBe(md)
  })

  it('素のURLは日本語・全角記号で打ち切る', () => {
    const blocks = parseMinutesMarkdown('詳細はhttps://example.com/aを参照。（https://example.com/b）')
    const links = (blocks[0].content as unknown as Array<Record<string, unknown>>).filter((c) => c.type === 'link')
    expect(links.map((l) => l.href)).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('素のURL末尾の句読点はURLに含めない', () => {
    const blocks = parseMinutesMarkdown('見て https://example.com/a. ください')
    const link = (blocks[0].content as unknown as Array<Record<string, unknown>>).find((c) => c.type === 'link')
    expect(link?.href).toBe('https://example.com/a')
  })

  it('href に ( ) を含む Wikipedia 風リンクを正しく扱う', () => {
    const md = '[東京](https://ja.wikipedia.org/wiki/東京_(曖昧さ回避))'
    const blocks = parseMinutesMarkdown(md)
    expect(blocks[0].content).toEqual([
      { type: 'link', href: 'https://ja.wikipedia.org/wiki/東京_(曖昧さ回避)', content: [{ type: 'text', text: '東京', styles: {} }] },
    ])
    expect(serializeMinutesBlocks(blocks)).toBe(md)
  })
})

describe('MEDIUM-9: 表セルの改行は<br>、見出しの改行は空白', () => {
  it('表セルの改行は<br>で書き、読み込みで改行に戻す', () => {
    const blocks: MinutesBlock[] = [
      {
        type: 'table',
        content: { type: 'tableContent', columnWidths: [], headerRows: 1, rows: [{ cells: [[t('a')], [t('b')]] }, { cells: [[t('1行目\n2行目')], [t('x')]] }] },
      },
    ]
    const out = serializeMinutesBlocks(blocks)
    expect(out).toBe('| a | b |\n| --- | --- |\n| 1行目<br>2行目 | x |')
    const back = parseMinutesMarkdown(out)
    const cellContent = (back[0].content as unknown as { rows: Array<{ cells: unknown[][] }> }).rows[1].cells[0]
    expect(cellContent).toEqual([{ type: 'text', text: '1行目\n2行目', styles: {} }])
  })

  it('見出しの中の改行は空白に置き換える', () => {
    const out = serializeMinutesBlocks([{ type: 'heading', props: { level: 2 }, content: [t('見出し\n- 箇条')] }])
    expect(out).toBe('## 見出し - 箇条')
    expect(serializeMinutesBlocks(parseMinutesMarkdown(out))).toBe(out)
  })
})

describe('MEDIUM-10: 入れ子の字下げ幅にゆるく、書き出しは2スペースにそろえる', () => {
  it('AIがよく書く3/4スペースの字下げも子として受ける', () => {
    const md = '1. 手順\n   - 補足A\n- 親\n    - 4スペース子'
    const blocks = parseMinutesMarkdown(md)
    expect(blocks[0].children).toEqual([{ type: 'bulletListItem', content: [{ type: 'text', text: '補足A', styles: {} }] }])
    expect(blocks[1].children).toEqual([{ type: 'bulletListItem', content: [{ type: 'text', text: '4スペース子', styles: {} }] }])
    const out = serializeMinutesBlocks(blocks)
    expect(out).toBe('1. 手順\n  - 補足A\n- 親\n  - 4スペース子')
  })
})

describe('MEDIUM-11: フェンスの info string と埋め込みバッククォート', () => {
  it('空白入りの info string(js title="x")を受ける', () => {
    const blocks = parseMinutesMarkdown('```js title="x"\nconst a = 1\n```')
    expect(blocks[0]).toMatchObject({ type: 'codeBlock', props: { language: 'js title="x"' } })
  })

  it('中に```の行があるコードは、より長いフェンスで囲む', () => {
    const out = serializeMinutesBlocks([{ type: 'codeBlock', props: { language: '' }, content: [t('a\n```\n**b**')] }])
    expect(out).toBe('````\na\n```\n**b**\n````')
    const back = parseMinutesMarkdown(out)
    expect(back).toEqual([{ type: 'codeBlock', props: { language: '' }, content: [{ type: 'text', text: 'a\n```\n**b**', styles: {} }] }])
  })
})

describe('MEDIUM-12: 番号付きstartの正規化・空段落の正規化', () => {
  it('直前も numberedListItem なら途中の start は無視して連番にする(BlockNoteの挙動に合わせる)', () => {
    const out = serializeMinutesBlocks([
      { type: 'numberedListItem', content: [t('a')] },
      { type: 'numberedListItem', content: [t('b')] },
      { type: 'numberedListItem', props: { start: 5 }, content: [t('c')] },
    ])
    expect(out).toBe('1. a\n2. b\n3. c')
  })

  it('空段落を挟んでも/末尾に付いても正規化して安定する', () => {
    const out1 = serializeMinutesBlocks([{ type: 'paragraph', content: [t('a')] }, { type: 'paragraph', content: [] }, { type: 'paragraph', content: [t('b')] }])
    expect(out1).toBe('a\n\nb')
    const out2 = serializeMinutesBlocks([{ type: 'paragraph', content: [t('a')] }, { type: 'paragraph', content: [] }])
    expect(out2).toBe('a')
  })

  it('リスト項目内の空行は正規化される', () => {
    const out = serializeMinutesBlocks([{ type: 'bulletListItem', content: [t('a\n\nb')] }])
    expect(out).toBe('- a\n  b')
    expect(serializeMinutesBlocks(parseMinutesMarkdown(out))).toBe(out)
  })
})

describe('LOW: 4個以上連続する*は文字として扱い、深い再帰で落ちない', () => {
  it('*が数千個連続しても RangeError にならない', () => {
    expect(() => serializeMinutesBlocks(parseMinutesMarkdown('*'.repeat(20000)))).not.toThrow()
  })

  it('4個連続する*は文字として保持される', () => {
    const blocks = parseMinutesMarkdown('****a****')
    const text = (blocks[0].content as Array<{ text: string }>).map((c) => c.text).join('')
    expect(text).toContain('a')
  })
})

describe('LOW: 空のコード・空のリンクは空の文字要素を作らない', () => {
  it('空コード(``)と[]()は要素を増やさない', () => {
    const blocks = parseMinutesMarkdown('a `` b\n\n[]()')
    expect(blocks[0].content).toEqual([{ type: 'text', text: 'a  b', styles: {} }])
    expect(blocks[1].content).toEqual([{ type: 'text', text: '[]()', styles: {} }])
  })
})

describe('LOW: [ ] で始まる普通の箇条書きがチェック項目に化けない', () => {
  it('bulletListItem の文字が [ ] で始まってもチェック項目に化けない', () => {
    const out = serializeMinutesBlocks([{ type: 'bulletListItem', content: [t('[ ] まだ')] }])
    expect(out).toBe('- \\[ ] まだ')
    const back = parseMinutesMarkdown(out)
    expect(back).toEqual([{ type: 'bulletListItem', content: [{ type: 'text', text: '[ ] まだ', styles: {} }] }])
  })
})

// ---- 必須の性質テスト: エディタが作りうる形のブロックをランダムに作って確認する ----

describe('性質テスト: エディタが作りうる形のランダムなブロックで S(P(S(b))) === S(b)', () => {
  // シードは固定(再現性のため)。入れ子・改行(codeBlock)・start・空段落・
  // スタイルの重なり(太字/斜体/取り消し線)・taskMarker・表のセル改行を混ぜる。
  function makeGenerator(seedInit: number) {
    let seed = seedInit
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)]
    const mkText = (text: string, styles: Record<string, boolean> = {}) => ({ type: 'text' as const, text, styles })
    const inlineAlpha = ['あ', 'a', ' ', '*', '~', '`', '\\', '#', '-', '1.', 'x']
    const rText = () => {
      let s = ''
      const n = 1 + Math.floor(rand() * 3)
      for (let i = 0; i < n; i++) s += pick(inlineAlpha)
      return s
    }
    const rStyles = (): Record<string, boolean> => {
      const r = rand()
      if (r < 0.15) return { bold: true }
      if (r < 0.28) return { italic: true }
      if (r < 0.36) return { strike: true }
      return {}
    }
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
    const rInline = (allowMarker: boolean) => {
      const out: Array<Record<string, unknown>> = []
      const n = 1 + Math.floor(rand() * 2)
      for (let i = 0; i < n; i++) {
        const tk = mkText(rText(), rStyles())
        const last = out[out.length - 1]
        if (last && last.type === 'text' && same(last.styles, tk.styles)) (last as { text: string }).text += tk.text
        else out.push(tk)
      }
      if (allowMarker && rand() < 0.15) out.push({ type: TASK_MARKER_TYPE, props: { taskId: 'id' + Math.floor(rand() * 9) } })
      return out
    }
    const listKinds = ['bulletListItem', 'checkListItem', 'numberedListItem']
    const topKinds = ['paragraph', 'heading', ...listKinds, 'codeBlock', 'table']
    const rBlock = (kind: string, depth: number): MinutesBlock => {
      const childKind = depth < 1 && listKinds.includes(kind) && rand() < 0.25 ? pick(listKinds) : null
      const children = childKind ? [rBlock(childKind, depth + 1)] : []
      if (kind === 'codeBlock') return { type: 'codeBlock', props: { language: '' }, content: [mkText(rText() + (rand() < 0.3 ? '\n' + rText() : ''))], children: [] }
      if (kind === 'table') {
        return {
          type: 'table',
          props: {},
          content: {
            type: 'tableContent',
            columnWidths: [],
            headerRows: 1,
            rows: [0, 1].map(() => ({ cells: [0, 1].map(() => rInline(false)) })),
          } as unknown as MinutesBlock['content'],
          children: [],
        }
      }
      const props: Record<string, unknown> =
        kind === 'heading'
          ? { level: 1 + Math.floor(rand() * 3) }
          : kind === 'checkListItem'
            ? { checked: rand() < 0.3 }
            : kind === 'numberedListItem' && rand() < 0.2
              ? { start: 2 + Math.floor(rand() * 8) }
              : {}
      const content = kind === 'paragraph' && rand() < 0.12 ? [] : (rInline(kind === 'checkListItem') as unknown as MinutesBlock['content'])
      return { type: kind, props, content, children }
    }
    return () => Array.from({ length: 1 + Math.floor(rand() * 3) }, () => rBlock(pick(topKinds), 0))
  }

  it('5000件で S(P(S(b))) === S(b) が成り立ち、例外も出さない', () => {
    const nextBlocks = makeGenerator(9)
    let unstable = 0
    for (let n = 0; n < 5000; n++) {
      const blocks = nextBlocks()
      expect(() => {
        const s1 = serializeMinutesBlocks(blocks)
        const s2 = serializeMinutesBlocks(parseMinutesMarkdown(s1))
        if (s2 !== s1) unstable++
      }).not.toThrow()
    }
    expect(unstable).toBe(0)
  })

  it('記号を除いた文字の中身は変換後も残っている(日本語の「あ」の個数で確認)', () => {
    // 生成に使う記号(*~`\#|-1.等)は逃がし/組み替えの対象になりうるので、
    // それらと衝突しない「あ」の出現回数が変換の前後で変わらないことを見る。
    const nextBlocks = makeGenerator(123)
    function countAInText(node: unknown): number {
      if (node == null) return 0
      if (typeof node === 'string') return (node.match(/あ/g) ?? []).length
      if (Array.isArray(node)) return node.reduce((sum: number, x) => sum + countAInText(x), 0)
      if (typeof node === 'object') {
        const o = node as Record<string, unknown>
        let sum = 0
        if (typeof o.text === 'string') sum += countAInText(o.text)
        if ('content' in o) sum += countAInText(o.content)
        if ('rows' in o) sum += countAInText(o.rows)
        if ('cells' in o) sum += countAInText(o.cells)
        if ('children' in o) sum += countAInText(o.children)
        return sum
      }
      return 0
    }
    for (let n = 0; n < 500; n++) {
      const blocks = nextBlocks()
      const before = countAInText(blocks)
      const out = serializeMinutesBlocks(blocks)
      const after = (out.match(/あ/g) ?? []).length
      expect(after).toBe(before)
    }
  })
})
