import { describe, it, expect } from 'vitest'
import { detectWikiBodyFormat, toWikiBlocksJson, TOGGLE_MARKER, type WikiBodyFormat } from './wikiBody.js'

/**
 * Wiki 本文の変換。アプリの Wiki 画面は BlockNote のブロック JSON しか読めないため、
 * Markdown / HTML はここで必ず変換される（変換しないと画面で空に見える）。
 */
describe('detectWikiBodyFormat', () => {
  it('ブロック JSON 配列は blocks', () => {
    expect(detectWikiBodyFormat('[{"type":"paragraph","content":[]}]')).toBe('blocks')
  })
  it('HTML らしい本文は html', () => {
    expect(detectWikiBodyFormat('<h1>見出し</h1><p>本文</p>')).toBe('html')
    expect(detectWikiBodyFormat('<!doctype html><html><body><p>x</p></body></html>')).toBe('html')
  })
  it('それ以外は markdown（先頭が [ でも JSON でなければ markdown）', () => {
    expect(detectWikiBodyFormat('# 見出し\n\n- 項目')).toBe('markdown')
    expect(detectWikiBodyFormat('[リンク](https://example.com) から始まる文')).toBe('markdown')
  })
})

describe('toWikiBlocksJson', () => {
  it('Markdown を見出し・箇条書き・段落のブロック JSON にする', async () => {
    const json = await toWikiBlocksJson('# 顧客ジャーニー\n\n- 集客\n- 相談\n\n本文 **太字**')
    const blocks = JSON.parse(json) as { type: string; content?: { text?: string; styles?: Record<string, boolean> }[] }[]
    expect(blocks[0]).toMatchObject({ type: 'heading', props: { level: 1 } })
    expect(blocks[0].content?.[0]?.text).toBe('顧客ジャーニー')
    expect(blocks.filter((b) => b.type === 'bulletListItem')).toHaveLength(2)
    const para = blocks.find((b) => b.type === 'paragraph')!
    expect(para.content?.some((c) => c.text === '太字' && c.styles?.bold)).toBe(true)
  })

  it('HTML を同じブロック JSON にする（表も含む）', async () => {
    const json = await toWikiBlocksJson('<h2>ターゲット分類</h2><p>5軸で分類</p><table><tr><th>軸</th><th>値</th></tr><tr><td>県内外</td><td>県内</td></tr></table>')
    const blocks = JSON.parse(json) as { type: string }[]
    expect(blocks[0]).toMatchObject({ type: 'heading', props: { level: 2 } })
    expect(blocks.some((b) => b.type === 'table')).toBe(true)
  })

  it('既にブロック JSON なら手を加えない・空文字は空のまま', async () => {
    const blocks = '[{"type":"paragraph","content":[{"type":"text","text":"x","styles":{}}]}]'
    expect(await toWikiBlocksJson(blocks)).toBe(blocks)
    expect(await toWikiBlocksJson('   ')).toBe('')
  })

  it('format を明示すれば推定より優先する', async () => {
    const json = await toWikiBlocksJson('<b>太字</b>', 'markdown')
    // Markdown として解釈されるので、HTML 要素としてではなくテキストとして入る
    expect(json).toContain('太字')
  })

  it('チェックリスト・番号付き・入れ子・コード・リンクも保つ（実務テンプレで使う要素）', async () => {
    const md = '## 手順\n\n1. 一つ目\n2. 二つ目\n   - 子の項目\n\n- [ ] 未完\n- [x] 完了\n\n```bash\necho hi\n```\n\n[参照](https://agentpm.app) を見る'
    const blocks = JSON.parse(await toWikiBlocksJson(md)) as { type: string; props?: Record<string, unknown>; children?: unknown[]; content?: { type: string; href?: string }[] }[]
    expect(blocks.filter((b) => b.type === 'numberedListItem')).toHaveLength(2)
    expect(blocks.find((b) => b.type === 'numberedListItem' && b.children?.length)).toBeTruthy()
    const checks = blocks.filter((b) => b.type === 'checkListItem')
    expect(checks.map((b) => b.props?.checked)).toEqual([false, true])
    expect(blocks.find((b) => b.type === 'codeBlock')).toMatchObject({ props: { language: 'bash' } })
    const para = blocks.find((b) => b.type === 'paragraph' && b.content?.some((c) => c.type === 'link'))!
    expect(para.content?.find((c) => c.type === 'link')?.href).toBe('https://agentpm.app')
  })

  it('React や DOM を要求しない（サーバー側の require フックに巻き込まれない）', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('./wikiBody.ts', import.meta.url), 'utf8'))
    // コメントで言及するのは可。import / require で読み込んでいないことを見る
    expect(src).not.toMatch(/(from|import\()\s*'@blocknote\/(server-util|react)'/)
    expect(src).not.toMatch(/from 'react'/)
  })
})

/**
 * 折りたたみ（BlockNote の toggleListItem）。決定事項に根拠をぶら下げる運用で、項目が多くても
 * 一覧として読めるようにする（Issue #917）。書き方は2つ受ける。
 * - `- <!--toggle-->題名` ＋ 字下げした中身（議事録 src/lib/minutes/markdown.ts と同じ約束）
 * - `<details><summary>題名</summary>中身</details>`（Markdown でも HTML でも）
 */
describe('折りたたみ（toggleListItem）', () => {
  interface B {
    type: string
    props?: Record<string, unknown>
    content?: { type: string; text?: string; styles?: Record<string, boolean>; href?: string }[]
    children?: B[]
  }
  const parse = async (body: string, format?: WikiBodyFormat) => JSON.parse(await toWikiBlocksJson(body, format)) as B[]
  const t = (text: string, styles: Record<string, boolean> = {}) => ({ type: 'text', text, styles })
  const textOf = (b: B) => (b.content ?? []).map((c) => c.text ?? '').join('')
  /** どの深さにもある「本文が空の箇条書き・折りたたみ」を集める */
  const emptyItems = (bs: B[]): B[] =>
    bs.flatMap((b) => [...(/ListItem$/.test(b.type) && textOf(b) === '' ? [b] : []), ...emptyItems(b.children ?? [])])

  it('`- <!--toggle-->題名` ＋ 字下げした中身は、折りたたみと子になる', async () => {
    const blocks = await parse('- <!--toggle-->なぜこの案にしたか\n  - 一次資料の数字と突き合わせられるため\n')
    expect(blocks).toEqual([
      {
        type: 'toggleListItem',
        content: [t('なぜこの案にしたか')],
        children: [{ type: 'bulletListItem', content: [t('一次資料の数字と突き合わせられるため')] }],
      },
    ])
  })

  it('折りたたみの題名の太字は保つ', async () => {
    const [toggle] = await parse('- <!--toggle-->**太字**の題名\n  - 子\n')
    expect(toggle.type).toBe('toggleListItem')
    expect(toggle.content).toEqual([t('太字', { bold: true }), t('の題名')])
  })

  it('`<details><summary>` は折りたたみになる（題名＝summary・中身＝子）', async () => {
    const blocks = await parse('<details>\n<summary>なぜこの案にしたか</summary>\n\n一次資料の数字と突き合わせられるため。\n\n</details>\n')
    expect(blocks).toEqual([
      {
        type: 'toggleListItem',
        content: [t('なぜこの案にしたか')],
        children: [{ type: 'paragraph', content: [t('一次資料の数字と突き合わせられるため。')] }],
      },
    ])
  })

  it('1行で書いた details と、summary の直後に空行が無い details も折りたたみになる', async () => {
    expect(await parse('<details><summary>題名</summary>中身</details>\n')).toEqual([
      { type: 'toggleListItem', content: [t('題名')], children: [{ type: 'paragraph', content: [t('中身')] }] },
    ])
    expect(await parse('<details>\n<summary>題</summary>\n本文すぐ\n</details>\n')).toEqual([
      { type: 'toggleListItem', content: [t('題')], children: [{ type: 'paragraph', content: [t('本文すぐ')] }] },
    ])
  })

  it('入れ子の details と、閉じたあとの段落の位置を保つ', async () => {
    const md =
      '<details>\n<summary>外</summary>\n\n外の本文\n\n<details>\n<summary>内</summary>\n\n内の本文\n\n</details>\n\n</details>\n\n後ろの段落\n'
    expect(await parse(md)).toEqual([
      {
        type: 'toggleListItem',
        content: [t('外')],
        children: [
          { type: 'paragraph', content: [t('外の本文')] },
          { type: 'toggleListItem', content: [t('内')], children: [{ type: 'paragraph', content: [t('内の本文')] }] },
        ],
      },
      { type: 'paragraph', content: [t('後ろの段落')] },
    ])
  })

  it('HTML で送った details も折りたたみになる', async () => {
    const blocks = await parse(
      '<h2>見出し</h2><details><summary>題名</summary><p>中身</p><ul><li>子</li></ul></details><p>後</p>',
      'html'
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'toggleListItem', 'paragraph'])
    expect(blocks[1]).toEqual({
      type: 'toggleListItem',
      content: [t('題名')],
      children: [
        { type: 'paragraph', content: [t('中身')] },
        { type: 'bulletListItem', content: [t('子')] },
      ],
    })
  })

  it('HTML コメントで始まる箇条書きでも本文が空にならない', async () => {
    expect(await parse('- <!--note-->メモです\n')).toEqual([{ type: 'bulletListItem', content: [t('メモです')] }])
  })

  it('チェックリストの子にも折りたたみを置ける', async () => {
    expect(await parse('- [ ] 決定A\n  - <!--toggle-->根拠\n    - 出典1\n')).toEqual([
      {
        type: 'checkListItem',
        props: { checked: false },
        content: [t('決定A')],
        children: [
          { type: 'toggleListItem', content: [t('根拠')], children: [{ type: 'bulletListItem', content: [t('出典1')] }] },
        ],
      },
    ])
  })

  it('Issue #917 の再現の本文で、本文が空の箇条書きが1つも無い', async () => {
    const md = [
      '# 折りたたみ検証',
      '',
      '<details>',
      '<summary>なぜこの案にしたか</summary>',
      '',
      '一次資料の数字と突き合わせられるため。',
      '',
      '</details>',
      '',
      '- <!--toggle-->なぜこの案にしたか',
      '  - 一次資料の数字と突き合わせられるため',
      '',
    ].join('\n')
    const blocks = await parse(md, 'markdown')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'toggleListItem', 'toggleListItem'])
    expect(emptyItems(blocks)).toEqual([])
  })

  it('折りたたみの目印は議事録（src/lib/minutes/markdown.ts）と同じ文字', async () => {
    const fs = await import('node:fs')
    const minutes = fs.readFileSync(new URL('../../../../src/lib/minutes/markdown.ts', import.meta.url), 'utf8')
    const m = /export const TOGGLE_MARKER = '([^']*)'/.exec(minutes)
    expect(m?.[1]).toBe(TOGGLE_MARKER)
  })
})
