import { describe, expect, it } from 'vitest'
import { parseMinutesMarkdown, serializeMinutesBlocks, TOC_MARKER, TOC_TYPE } from '@/lib/minutes/markdown'
import { collectHeadings, type BlockNoteEditorLike } from '@/components/meeting/minutesBlocks'

/**
 * 目次は Markdown の `<!--toc-->` と、画面の1ブロックが対になっている。
 * 片方だけ変えると、入れた目次が保存で消える（議事録は Markdown が正本）。
 */
describe('目次の往復', () => {
  it('`<!--toc-->` の行が目次ブロックになる', () => {
    const blocks = parseMinutesMarkdown('# 題名\n\n<!--toc-->\n\n## 1. 前提\n\n本文\n')
    const types = blocks.map((b) => b.type)
    expect(types).toContain(TOC_TYPE)
    // 前後の見出し・本文を飲み込まない
    expect(types).toEqual(['heading', TOC_TYPE, 'heading', 'paragraph'])
  })

  it('目次ブロックは `<!--toc-->` の1行に戻る', () => {
    const md = '# 題名\n\n<!--toc-->\n\n## 1. 前提\n\n本文\n'
    const round = serializeMinutesBlocks(parseMinutesMarkdown(md))
    expect(round).toContain(TOC_MARKER)
    // 何度往復しても増えない・化けない
    const twice = serializeMinutesBlocks(parseMinutesMarkdown(round))
    expect(twice).toBe(round)
    expect((twice.match(/<!--toc-->/g) ?? []).length).toBe(1)
  })

  it('目次と紛らわしい行は段落のままにする', () => {
    const blocks = parseMinutesMarkdown('<!--toc-->は目次の印です\n')
    expect(blocks[0].type).toBe('paragraph')
  })
})

describe('見出しの拾い出し', () => {
  const editor = (doc: unknown[]): BlockNoteEditorLike =>
    ({ document: doc } as BlockNoteEditorLike)

  it('見出しだけを、階層と文字つきで拾う', () => {
    const items = collectHeadings(
      editor([
        { id: 'a', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '1. 前提' }] },
        { id: 'b', type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
        { id: 'c', type: 'heading', props: { level: 3 }, content: [{ type: 'text', text: '1-1. 内訳' }] },
      ])
    )
    expect(items).toEqual([
      { id: 'a', level: 2, text: '1. 前提' },
      { id: 'c', level: 3, text: '1-1. 内訳' },
    ])
  })

  it('リンクの中の字も拾う', () => {
    const items = collectHeadings(
      editor([
        {
          id: 'a',
          type: 'heading',
          props: { level: 2 },
          content: [{ type: 'link', href: '#x', content: [{ type: 'text', text: 'TP-620' }] }],
        },
      ])
    )
    expect(items[0].text).toBe('TP-620')
  })

  it('文字の無い見出しは出さない（押しても意味が無い）', () => {
    const items = collectHeadings(
      editor([{ id: 'a', type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: '  ' }] }])
    )
    expect(items).toEqual([])
  })
})
