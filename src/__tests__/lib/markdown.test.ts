import { describe, it, expect } from 'vitest'
import { renderMarkdownToHtml, splitOnCtaPlaceholder } from '@/lib/markdown'

describe('renderMarkdownToHtml', () => {
  it('見出しに id を付与する（rehype-slug）', async () => {
    const html = await renderMarkdownToHtml('## 資料回収とは')
    expect(html).toContain('<h2')
    expect(html).toMatch(/id="[^"]+"/)
  })

  it('GFM のテーブルを描画する', async () => {
    const html = await renderMarkdownToHtml('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table>')
  })

  it('script タグをサニタイズして除去する（XSS防止）', async () => {
    const html = await renderMarkdownToHtml('通常テキスト\n\n<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('alert(1)')
  })

  it('onerror などのイベントハンドラ属性を除去する', async () => {
    const html = await renderMarkdownToHtml('<img src="x" onerror="alert(1)">')
    expect(html).not.toContain('onerror')
  })

  it('通常のリンク・強調は保持する', async () => {
    const html = await renderMarkdownToHtml('**強調** と [リンク](https://example.com)')
    expect(html).toContain('<strong>強調</strong>')
    expect(html).toContain('href="https://example.com"')
  })
})

describe('splitOnCtaPlaceholder', () => {
  it('{{cta}} で本文を before / after に分割する', () => {
    const { before, after, hasPlaceholder } = splitOnCtaPlaceholder('前half\n\n{{cta}}\n\n後half')
    expect(hasPlaceholder).toBe(true)
    expect(before).toContain('前half')
    expect(after).toContain('後half')
    expect(before).not.toContain('{{cta}}')
    expect(after).not.toContain('{{cta}}')
  })

  it('プレースホルダが無ければ全文を before に入れ hasPlaceholder=false', () => {
    const { before, after, hasPlaceholder } = splitOnCtaPlaceholder('プレースホルダなし本文')
    expect(hasPlaceholder).toBe(false)
    expect(before).toBe('プレースホルダなし本文')
    expect(after).toBe('')
  })

  it('最初の1つだけで分割する（2つ目以降は after 側に残す）', () => {
    const { before, after } = splitOnCtaPlaceholder('A{{cta}}B{{cta}}C')
    expect(before).toBe('A')
    expect(after).toBe('B{{cta}}C')
  })
})
