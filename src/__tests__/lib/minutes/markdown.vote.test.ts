import { describe, expect, it } from 'vitest'
import { parseMinutesMarkdown, serializeMinutesBlocks } from '@/lib/minutes/markdown'

const ID = '0b6f0c1e-7a3d-4c1b-9e2a-1f2e3d4c5b6a'

describe('議事録の投票ブロック（<!--vote:番号-->議題）', () => {
  it('読むと投票ブロックになり、番号・設定・議題を持つ', () => {
    const [b] = parseMinutesMarkdown(`<!--vote:${ID} must-->デザイン案Bで進める`)
    expect(b.type).toBe('docPoll')
    expect(b.props).toEqual({ pollId: ID, reasonRequired: 'ng_hold' })
    expect(JSON.stringify(b.content)).toContain('デザイン案Bで進める')
  })

  it('理由任意と空の議題も往復で変わらない', () => {
    for (const md of [`<!--vote:${ID}-->来週の定例を金曜に`, `<!--vote:${ID}-->`, `<!--vote:${ID} must-->案B`]) {
      expect(serializeMinutesBlocks(parseMinutesMarkdown(md))).toBe(md)
    }
  })

  it('段落の途中でも投票の行から切れる。前後の行はそのまま残る', () => {
    const md = `前の行\n<!--vote:${ID}-->議題\n\n後の段落`
    const blocks = parseMinutesMarkdown(md)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'docPoll', 'paragraph'])
    expect(serializeMinutesBlocks(blocks)).toContain(`<!--vote:${ID}-->議題`)
  })

  it('議題の改行は空白にして1行で書く', () => {
    const md = serializeMinutesBlocks([
      { type: 'docPoll', props: { pollId: ID, reasonRequired: 'none' }, content: [{ type: 'text', text: 'A\nB', styles: {} }], children: [] },
    ])
    expect(md).toBe(`<!--vote:${ID}-->A B`)
  })
})
