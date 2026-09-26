import { describe, expect, it } from 'vitest'
import { parseMinutesMarkdown, serializeMinutesBlocks } from '@/lib/minutes/markdown'

const ID = '5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const ID2 = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

describe('相手先が足した行・メモ（<!--ins:番号 種類 日時 名前-->本文）', () => {
  it('読むと差し込みのブロックになり、番号・種類・日時・名前（空白を含む）を持つ', () => {
    const [b] = parseMinutesMarkdown(`<!--ins:${ID} meeting_note 2026-09-26T14:30 鈴木 一郎-->予算が合わない`)
    expect(b.type).toBe('docInsertion')
    expect(b.props).toEqual({ insertionId: ID, kind: 'meeting_note', createdAt: '2026-09-26T14:30', author: '鈴木 一郎' })
    expect(JSON.stringify(b.content)).toContain('予算が合わない')
  })

  it('複数行・名前なし・行（paragraph）も往復で変わらない', () => {
    for (const md of [
      `<!--ins:${ID} paragraph 2026-09-26T14:30 鈴木 一郎-->1行目\n<!--ins-->2行目`,
      `<!--ins:${ID} paragraph 2026-09-26T14:30-->名前なし`,
      `前の段落\n\n<!--ins:${ID} meeting_note 2026-09-26T09:05 田中-->メモ\n\n後の段落`,
    ]) {
      expect(serializeMinutesBlocks(parseMinutesMarkdown(md))).toBe(md)
    }
  })

  it('続けて書かれた2つの差し込みは、1つに溶けない', () => {
    const md = `<!--ins:${ID} paragraph 2026-09-26T14:30 A-->一つ目\n<!--ins:${ID2} paragraph 2026-09-26T14:31 B-->二つ目`
    const blocks = parseMinutesMarkdown(md)
    expect(blocks.map((b) => b.props?.insertionId)).toEqual([ID, ID2])
  })

  it('段落の途中でも差し込みの行から切れる', () => {
    const blocks = parseMinutesMarkdown(`前の行\n<!--ins:${ID} paragraph 2026-09-26T14:30 A-->足した行`)
    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'docInsertion'])
  })

  it('番号の形が違う・日時が無い目印は差し込みとして読まない（文字として残す）', () => {
    const [b] = parseMinutesMarkdown('<!--ins:xxx paragraph 2026-09-26T14:30 A-->本文')
    expect(b.type).not.toBe('docInsertion')
  })
})
