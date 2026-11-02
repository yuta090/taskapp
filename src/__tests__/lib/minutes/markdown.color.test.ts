/**
 * 議事録の行の色（Wiki と同じ背景色・文字色）。本文の正本は Markdown なので、色は
 * ブロックの前の1行 `<!--color:bg=red-->` に残す。行末に付けないのは、DB のタスク化が
 * 行末の `<!--task:uuid-->` を見ていて、題名にも印が混ざるから。
 */
import { describe, expect, it } from 'vitest'
import { parseMinutesMarkdown, serializeMinutesBlocks, type MinutesBlock } from '@/lib/minutes/markdown'

const text = (t: string) => [{ type: 'text', text: t, styles: {} }]

function roundTrip(md: string) {
  expect(serializeMinutesBlocks(parseMinutesMarkdown(md))).toBe(md)
}

describe('議事録の行の色', () => {
  it('背景色をブロックの前の1行に書き出す', () => {
    const out = serializeMinutesBlocks([
      { id: 'x', type: 'paragraph', props: { backgroundColor: 'red', textColor: 'default' }, content: text('重要') },
    ])
    expect(out).toBe('<!--color:bg=red-->\n重要')
  })

  it('文字色も一緒に残す（「⠿ → 色を変更」で選べるので、消すと黙って色が戻る）', () => {
    const out = serializeMinutesBlocks([
      { type: 'heading', props: { level: 2, backgroundColor: 'blue', textColor: 'red' }, content: text('見出し') },
    ])
    expect(out).toBe('<!--color:bg=blue text=red-->\n## 見出し')
    expect(parseMinutesMarkdown(out)[0].props).toEqual({ level: 2, backgroundColor: 'blue', textColor: 'red' })
  })

  it('色なし・知らない色は書かない', () => {
    expect(
      serializeMinutesBlocks([{ type: 'paragraph', props: { backgroundColor: 'default', textColor: 'default' }, content: text('a') }])
    ).toBe('a')
    expect(serializeMinutesBlocks([{ type: 'paragraph', props: { backgroundColor: 'x-->' }, content: text('a') }])).toBe('a')
  })

  it('段落・見出し・リスト・折りたたみ・表で往復しても形が変わらない', () => {
    roundTrip('<!--color:bg=yellow-->\n段落')
    roundTrip('<!--color:bg=green-->\n# 見出し')
    roundTrip('- a\n<!--color:bg=red-->\n- b\n- c')
    roundTrip('<!--color:bg=red-->\n1. a\n2. b')
    roundTrip('<!--color:bg=purple-->\n- <!--toggle-->題名\n  - 中身')
    roundTrip('<!--color:bg=gray-->\n| a | b |\n| --- | --- |\n| 1 | 2 |')
  })

  it('字下げした子の項目にも付けられ、親子関係が崩れない', () => {
    const md = '- 親\n  <!--color:bg=pink-->\n  - 子1\n  - 子2\n- 次'
    roundTrip(md)
    const blocks = parseMinutesMarkdown(md)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].props).toBeUndefined()
    expect(blocks[0].children?.[0].props).toEqual({ backgroundColor: 'pink' })
    expect(blocks[0].children?.[1].props).toBeUndefined()
  })

  it('色はすぐ後ろの1ブロックだけに付く', () => {
    const blocks = parseMinutesMarkdown('<!--color:bg=red-->\na\n\nb')
    expect(blocks[0].props).toEqual({ backgroundColor: 'red' })
    expect(blocks[1].props).toBeUndefined()
  })

  it('段落の途中に来たら段落を切る', () => {
    const blocks = parseMinutesMarkdown('a\n<!--color:bg=red-->\nb')
    expect(blocks.map((b) => b.props?.backgroundColor)).toEqual([undefined, 'red'])
  })

  it('タスクの行では印が行末のまま（DB のタスク化が見る行を変えない）', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const md = `<!--color:bg=red-->\n- [ ] 見積を出す <!--task:${id}-->`
    roundTrip(md)
    expect(md.split('\n')[1]).toMatch(/^-\s*\[\s*\]\s*.+<!--task:[^>]+-->\s*$/)
  })

  it('色を持てないブロックに続く印は捨てる', () => {
    const blocks = parseMinutesMarkdown('<!--color:bg=red-->\n---')
    expect(blocks[0].type).toBe('divider')
    expect(blocks[0].props?.backgroundColor).toBeUndefined()
  })

  it('文字として書かれた同じ形は、印にならず文字のまま残る', () => {
    const blocks: MinutesBlock[] = [{ type: 'paragraph', content: text('<!--color:bg=red-->') as never }]
    const md = serializeMinutesBlocks(blocks)
    expect(parseMinutesMarkdown(md)[0].content).toEqual(blocks[0].content)
    expect(parseMinutesMarkdown(md)[0].props).toBeUndefined()
  })

  it('形の違う印はこれまでどおり文字として残す', () => {
    const blocks = parseMinutesMarkdown('<!--color:bg=neon-->')
    expect(JSON.stringify(blocks[0].content)).toContain('neon')
  })

  it('空の行の色は残さない（空の段落はもともと保存されない）', () => {
    expect(serializeMinutesBlocks([{ type: 'paragraph', props: { backgroundColor: 'red' }, content: [] }])).toBe('')
  })
})
