import { describe, expect, it } from 'vitest'
import { parseWikiBody, safeLinkHref, type WikiBlock } from './wikiBody'

/** Wiki が保存する BlockNote の JSON（本番の4ページと同じ形: props・id・children つき） */
const props = { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' }
const t = (text: string, styles: Record<string, unknown> = {}) => ({ type: 'text', text, styles })
const body = (blocks: unknown[]) => JSON.stringify(blocks)

describe('parseWikiBody: 空・JSON でない本文', () => {
  it('null・空文字・空白・空配列は空のブロック列', () => {
    expect(parseWikiBody(null)).toEqual([])
    expect(parseWikiBody('')).toEqual([])
    expect(parseWikiBody('  \n ')).toEqual([])
    expect(parseWikiBody('[]')).toEqual([])
  })

  it('JSON として読めない本文は、全文を1つの段落にする（改行はそのまま）', () => {
    const md = '# 見出し\n\n- 項目\n<!--toggle-->題名'
    const blocks = parseWikiBody(md)
    expect(blocks).toEqual([{ type: 'paragraph', spans: [{ text: md }], children: [] }])
  })

  it('JSON でもブロックの配列でなければ（数値・文字列・配列の中身がブロックでない）文字として出す', () => {
    expect(parseWikiBody('123')).toEqual([{ type: 'paragraph', spans: [{ text: '123' }], children: [] }])
    expect(parseWikiBody('[1,2]')).toEqual([{ type: 'paragraph', spans: [{ text: '[1,2]' }], children: [] }])
    expect(parseWikiBody('{"type":"paragraph"}')).toEqual([
      { type: 'paragraph', spans: [{ text: '{"type":"paragraph"}' }], children: [] },
    ])
  })
})

describe('parseWikiBody: 見出し・段落', () => {
  it('見出し（level 1〜3）と段落を読む', () => {
    const blocks = parseWikiBody(
      body([
        { id: 'a', type: 'heading', props: { ...props, level: 2, isToggleable: false }, content: [t('プロジェクト概要')], children: [] },
        { id: 'b', type: 'paragraph', props, content: [t('本文です')], children: [] },
      ])
    )
    expect(blocks).toEqual([
      { type: 'heading', level: 2, spans: [{ text: 'プロジェクト概要' }], children: [] },
      { type: 'paragraph', spans: [{ text: '本文です' }], children: [] },
    ])
  })

  it('level が無い・範囲外の見出しは 1〜3 に収める', () => {
    const blocks = parseWikiBody(
      body([
        { type: 'heading', content: [t('a')] },
        { type: 'heading', props: { level: 9 }, content: [t('b')] },
      ])
    ) as Extract<WikiBlock, { type: 'heading' }>[]
    expect(blocks.map((b) => b.level)).toEqual([1, 3])
  })

  it('インラインの太字・斜体・取り消し線・コード・リンクを読む', () => {
    const [p] = parseWikiBody(
      body([
        {
          type: 'paragraph',
          content: [
            t('太', { bold: true }),
            t('斜', { italic: true, textColor: 'red' }),
            t('消', { strike: true }),
            t('code', { code: true }),
            { type: 'link', href: 'https://example.com/a', content: [t('リンク', { bold: true })] },
          ],
        },
      ])
    ) as Extract<WikiBlock, { type: 'paragraph' }>[]
    expect(p.spans).toEqual([
      { text: '太', bold: true },
      { text: '斜', italic: true },
      { text: '消', strike: true },
      { text: 'code', code: true },
      { text: 'リンク', bold: true, href: 'https://example.com/a' },
    ])
  })

  it('空のテキストは落とし、改行はそのまま残す', () => {
    const [p] = parseWikiBody(body([{ type: 'paragraph', content: [t(''), t('1行目\n2行目')] }])) as Extract<
      WikiBlock,
      { type: 'paragraph' }
    >[]
    expect(p.spans).toEqual([{ text: '1行目\n2行目' }])
  })

  it('content が無い段落（空行）も段落として残す', () => {
    expect(parseWikiBody(body([{ type: 'paragraph', props, content: [], children: [] }]))).toEqual([
      { type: 'paragraph', spans: [], children: [] },
    ])
  })
})

describe('parseWikiBody: リンクの安全', () => {
  it('http と https だけ開ける', () => {
    expect(safeLinkHref('https://agentpm.app/x?y=1')).toBe('https://agentpm.app/x?y=1')
    expect(safeLinkHref('HTTP://example.com')).toBe('HTTP://example.com')
  })

  it('Web 内の相対パス（/ で始まる）は残す。プロトコル相対（//）は除く', () => {
    expect(safeLinkHref('/org/project/space/wiki?page=1')).toBe('/org/project/space/wiki?page=1')
    expect(safeLinkHref('//evil.example.com')).toBeUndefined()
  })

  it('javascript: / data: / mailto: / tel: / 空 / 制御文字を挟んだ偽装は開けない', () => {
    expect(safeLinkHref('javascript:alert(1)')).toBeUndefined()
    expect(safeLinkHref('  JavaScript:alert(1)')).toBeUndefined()
    expect(safeLinkHref('java\tscript:alert(1)')).toBeUndefined()
    expect(safeLinkHref('data:text/html,<b>x</b>')).toBeUndefined()
    expect(safeLinkHref('mailto:a@example.com')).toBeUndefined()
    expect(safeLinkHref('tel:0312345678')).toBeUndefined()
    expect(safeLinkHref('')).toBeUndefined()
    expect(safeLinkHref(undefined)).toBeUndefined()
    expect(safeLinkHref(42)).toBeUndefined()
  })

  it('危険なリンクの文字は残し、href だけ外す', () => {
    const [p] = parseWikiBody(
      body([{ type: 'paragraph', content: [{ type: 'link', href: 'javascript:alert(1)', content: [t('押さないで')] }] }])
    ) as Extract<WikiBlock, { type: 'paragraph' }>[]
    expect(p.spans).toEqual([{ text: '押さないで' }])
  })
})

describe('parseWikiBody: 箇条書き・チェック・折りたたみ・引用', () => {
  it('箇条書きは入れ子（children）を保つ', () => {
    const blocks = parseWikiBody(
      body([
        {
          type: 'bulletListItem',
          props,
          content: [t('親', { bold: true }), t('です')],
          children: [
            { type: 'bulletListItem', content: [t('子1')], children: [{ type: 'bulletListItem', content: [t('孫')], children: [] }] },
            { type: 'bulletListItem', content: [t('子2')], children: [] },
          ],
        },
      ])
    )
    expect(blocks).toEqual([
      {
        type: 'bullet',
        spans: [{ text: '親', bold: true }, { text: 'です' }],
        children: [
          { type: 'bullet', spans: [{ text: '子1' }], children: [{ type: 'bullet', spans: [{ text: '孫' }], children: [] }] },
          { type: 'bullet', spans: [{ text: '子2' }], children: [] },
        ],
      },
    ])
  })

  it('番号付きは連続する間だけ数え、間に別のブロックが入ると 1 から数え直す', () => {
    const blocks = parseWikiBody(
      body([
        { type: 'numberedListItem', content: [t('a')] },
        { type: 'numberedListItem', content: [t('b')] },
        { type: 'paragraph', content: [t('区切り')] },
        { type: 'numberedListItem', content: [t('c')] },
      ])
    )
    expect(blocks.filter((b) => b.type === 'numbered').map((b) => (b as { number: number }).number)).toEqual([1, 2, 1])
  })

  it('番号付きは start があればそこから数える', () => {
    const blocks = parseWikiBody(
      body([
        { type: 'numberedListItem', props: { start: 5 }, content: [t('a')] },
        { type: 'numberedListItem', content: [t('b')] },
      ])
    )
    expect(blocks.map((b) => (b as { number: number }).number)).toEqual([5, 6])
  })

  it('チェックボックスは checked を持つ', () => {
    const blocks = parseWikiBody(
      body([
        { type: 'checkListItem', props: { checked: true }, content: [t('済')] },
        { type: 'checkListItem', props: { checked: false }, content: [t('未')] },
        { type: 'checkListItem', content: [t('指定なし')] },
      ])
    )
    expect(blocks.map((b) => (b as { checked: boolean }).checked)).toEqual([true, false, false])
  })

  it('折りたたみ（toggleListItem）は題名と中身（children）を読む', () => {
    const blocks = parseWikiBody(
      body([{ type: 'toggleListItem', content: [t('詳細')], children: [{ type: 'paragraph', content: [t('中身')] }] }])
    )
    expect(blocks).toEqual([
      { type: 'toggle', spans: [{ text: '詳細' }], children: [{ type: 'paragraph', spans: [{ text: '中身' }], children: [] }] },
    ])
  })

  it('折りたたみ見出し（isToggleable）も見出しとして、中身を落とさず読む', () => {
    const blocks = parseWikiBody(
      body([
        {
          type: 'heading',
          props: { level: 2, isToggleable: true },
          content: [t('見出し')],
          children: [{ type: 'paragraph', content: [t('中身')] }],
        },
      ])
    )
    expect(blocks).toEqual([
      {
        type: 'heading',
        level: 2,
        spans: [{ text: '見出し' }],
        children: [{ type: 'paragraph', spans: [{ text: '中身' }], children: [] }],
      },
    ])
  })

  it('引用・コード・区切り線', () => {
    const blocks = parseWikiBody(
      body([
        { type: 'quote', content: [t('引用です')] },
        { type: 'codeBlock', props: { language: 'ts' }, content: [t('const a = 1\nconst b = 2')] },
        { type: 'divider' },
      ])
    )
    expect(blocks).toEqual([
      { type: 'quote', spans: [{ text: '引用です' }], children: [] },
      { type: 'code', text: 'const a = 1\nconst b = 2', language: 'ts' },
      { type: 'divider' },
    ])
  })

  it('コードの中身は書式やリンクがあっても文字だけをつなぐ', () => {
    const [c] = parseWikiBody(
      body([{ type: 'codeBlock', content: [t('a', { bold: true }), t('b')] }])
    ) as Extract<WikiBlock, { type: 'code' }>[]
    expect(c.text).toBe('ab')
    expect(c.language).toBe('')
  })
})

describe('parseWikiBody: 表', () => {
  const cell = (text: string, styles: Record<string, unknown> = {}) => ({
    type: 'tableCell',
    content: text === '' ? [] : [t(text, styles)],
    props: { colspan: 1, rowspan: 1, ...props },
  })

  it('BlockNote の表（tableCell つき）を行と列で読む。見出し行は太字', () => {
    const blocks = parseWikiBody(
      body([
        {
          type: 'table',
          props: { textColor: 'default' },
          content: {
            type: 'tableContent',
            columnWidths: [null, null],
            rows: [
              { cells: [cell('項目', { bold: true }), cell('内容', { bold: true })] },
              { cells: [cell('期限'), cell('')] },
            ],
          },
          children: [],
        },
      ])
    )
    expect(blocks).toEqual([
      {
        type: 'table',
        rows: [
          [[{ text: '項目', bold: true }], [{ text: '内容', bold: true }]],
          [[{ text: '期限' }], []],
        ],
      },
    ])
  })

  it('CLI から入った表（セルがインライン配列そのもの）も読む', () => {
    const blocks = parseWikiBody(
      body([
        {
          type: 'table',
          content: { type: 'tableContent', rows: [{ cells: [[t('A')], [{ type: 'link', href: 'https://x.test', content: [t('B')] }]] }] },
        },
      ])
    )
    expect(blocks).toEqual([
      { type: 'table', rows: [[[{ text: 'A' }], [{ text: 'B', href: 'https://x.test' }]]] },
    ])
  })

  it('壊れた表（content が表でない・rows が無い）は落ちず、空の表になる', () => {
    expect(parseWikiBody(body([{ type: 'table', content: [] }]))).toEqual([{ type: 'table', rows: [] }])
    expect(parseWikiBody(body([{ type: 'table', content: { type: 'tableContent' } }]))).toEqual([{ type: 'table', rows: [] }])
  })
})

describe('parseWikiBody: Web で開いてもらう部分・未対応の型', () => {
  it.each(['meetingsList', 'docPoll', 'docInsertion', 'tableOfContents', 'meetingNote'])(
    '%s は「この部分は Web で開いてください」の1行にする',
    (type) => {
      expect(parseWikiBody(body([{ id: 'x', type, props: { limit: '5' }, children: [] }]))).toEqual([
        { type: 'notice', message: 'この部分は Web で開いてください', children: [] },
      ])
    }
  )

  it('会議メモ（meetingNote）に文字があっても、1行の案内にして中身の子は読む', () => {
    const blocks = parseWikiBody(
      body([{ type: 'meetingNote', content: [t('メモ')], children: [{ type: 'paragraph', content: [t('子')] }] }])
    )
    expect(blocks).toEqual([
      {
        type: 'notice',
        message: 'この部分は Web で開いてください',
        children: [{ type: 'paragraph', spans: [{ text: '子' }], children: [] }],
      },
    ])
  })

  it('知らない型でも、中身の文字は段落として出す（本文を落とさない）', () => {
    expect(parseWikiBody(body([{ type: 'futureBlock', content: [t('新しい種類')], children: [] }]))).toEqual([
      { type: 'paragraph', spans: [{ text: '新しい種類' }], children: [] },
    ])
  })

  it('知らない型で文字が無ければ、何も出さない', () => {
    expect(parseWikiBody(body([{ type: 'futureBlock', props: {}, children: [] }]))).toEqual([])
  })

  it('画像・ファイルなどは Web の案内にする', () => {
    expect(parseWikiBody(body([{ type: 'image', props: { url: 'https://x.test/a.png' } }]))).toEqual([
      { type: 'notice', message: 'この部分は Web で開いてください', children: [] },
    ])
  })

  it('インラインの未知の種類は、中身の文字があれば出し、無ければ落とす', () => {
    const [p] = parseWikiBody(
      body([
        {
          type: 'paragraph',
          content: [{ type: 'mention', props: { id: 'u' } }, { type: 'custom', content: [t('中')] }, t('外')],
        },
      ])
    ) as Extract<WikiBlock, { type: 'paragraph' }>[]
    expect(p.spans).toEqual([{ text: '中' }, { text: '外' }])
  })

  it('HTML は描かず、そのまま文字として出す', () => {
    const [p] = parseWikiBody(body([{ type: 'paragraph', content: [t('<script>alert(1)</script><b>x</b>')] }])) as Extract<
      WikiBlock,
      { type: 'paragraph' }
    >[]
    expect(p.spans).toEqual([{ text: '<script>alert(1)</script><b>x</b>' }])
  })

  it('深すぎる入れ子でも落ちない（それより深い部分は Web の案内にする）', () => {
    let node: Record<string, unknown> = { type: 'paragraph', content: [t('底')] }
    for (let i = 0; i < 200; i++) node = { type: 'bulletListItem', content: [t(`l${i}`)], children: [node] }
    expect(() => parseWikiBody(body([node]))).not.toThrow()
  })
})

describe('parseWikiBody: 本番の Wiki と同じ形', () => {
  it('見出し・表・箇条書き・会議一覧を混ぜた本文を順番どおりに読む', () => {
    const blocks = parseWikiBody(
      body([
        { id: '1', type: 'heading', props: { ...props, level: 2, isToggleable: false }, content: [t('進め方')], children: [] },
        { id: '2', type: 'bulletListItem', props, content: [t('定例', { bold: true }), t('は毎週月曜')], children: [] },
        { id: '3', type: 'meetingsList', props: { orgId: 'o', spaceId: 's', limit: '5' }, children: [] },
        { id: '4', type: 'paragraph', props, content: [], children: [] },
      ])
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'bullet', 'notice', 'paragraph'])
  })
})
