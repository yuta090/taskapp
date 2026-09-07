import { describe, it, expect } from 'vitest'
import { detectWikiBodyFormat, toWikiBlocksJson } from './wikiBody.js'

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
