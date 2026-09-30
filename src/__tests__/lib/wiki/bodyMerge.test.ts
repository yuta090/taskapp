import { describe, expect, it } from 'vitest'
import { wikiAppendedBlocks, wikiBodiesEquivalent, wikiContentHash } from '@/lib/wiki/bodyMerge'

const a = { id: 'a', type: 'paragraph', props: { textAlignment: 'left' }, content: [{ type: 'text', text: 'A', styles: {} }], children: [] }
const b = { id: 'b', type: 'paragraph', content: [{ type: 'text', text: 'B', styles: {} }], children: [] }
const tail = { type: 'paragraph', content: [{ type: 'text', text: '確定', styles: {} }] }

describe('wikiAppendedBlocks（末尾に足されただけか）', () => {
  it('知っている本文の後ろにブロックが足されただけなら、足された分を返す', () => {
    expect(wikiAppendedBlocks(JSON.stringify([a, b]), JSON.stringify([a, b, tail]))).toEqual([tail])
  })

  it('DB で組み立て直してキーの順や空白が変わっていても、同じ中身なら末尾の追記と見なす', () => {
    // rpc_set_spec_state は jsonb を ::text にするので、キーの順と空白が変わる
    const reordered = `[{"children": [], "content": [{"styles": {}, "text": "A", "type": "text"}], "id": "a", "props": {"textAlignment": "left"}, "type": "paragraph"}, ${JSON.stringify(b)}, ${JSON.stringify(tail)}]`
    expect(wikiAppendedBlocks(JSON.stringify([a, b]), reordered)).toEqual([tail])
  })

  it('途中が書き換わっていたら null（本当の競合）', () => {
    const changed = { ...b, content: [{ type: 'text', text: 'B2', styles: {} }] }
    expect(wikiAppendedBlocks(JSON.stringify([a, b]), JSON.stringify([a, changed, tail]))).toBeNull()
  })

  it('何も足されていない・減っている・読めないときは null', () => {
    expect(wikiAppendedBlocks(JSON.stringify([a, b]), JSON.stringify([a, b]))).toBeNull()
    expect(wikiAppendedBlocks(JSON.stringify([a, b]), JSON.stringify([a]))).toBeNull()
    expect(wikiAppendedBlocks('{壊れている', JSON.stringify([a, tail]))).toBeNull()
    expect(wikiAppendedBlocks(JSON.stringify([a]), '{壊れている')).toBeNull()
  })

  it('知っている本文が空なら、全部が足された分', () => {
    expect(wikiAppendedBlocks(null, JSON.stringify([tail]))).toEqual([tail])
    expect(wikiAppendedBlocks('', JSON.stringify([tail]))).toEqual([tail])
  })
})

describe('wikiContentHash', () => {
  it('キーの順が違うだけなら同じ値になる', () => {
    expect(wikiContentHash('{"a":1,"b":2}')).toBe(wikiContentHash('{"b": 2, "a": 1}'))
  })

  it('中身が違えば違う値、null と空は同じ', () => {
    expect(wikiContentHash('[1]')).not.toBe(wikiContentHash('[2]'))
    expect(wikiContentHash(null)).toBe(wikiContentHash(''))
  })
})

describe('wikiBodiesEquivalent（見分け番号だけの違いは同じ本文と見なす）', () => {
  it('ブロックの id だけが違う本文は同じ', () => {
    const x = JSON.stringify([{ id: 'a', type: 'paragraph', content: [], children: [] }])
    const y = JSON.stringify([{ id: 'b', type: 'paragraph', content: [], children: [] }])
    expect(wikiBodiesEquivalent(x, y)).toBe(true)
  })

  it('中身が違えば違う・並びが違えば違う', () => {
    const p = (text: string, id = 'x') => ({ id, type: 'paragraph', content: [{ type: 'text', text, styles: {} }], children: [] })
    expect(wikiBodiesEquivalent(JSON.stringify([p('あ')]), JSON.stringify([p('い')]))).toBe(false)
    expect(wikiBodiesEquivalent(JSON.stringify([p('あ', '1'), p('い', '2')]), JSON.stringify([p('い', '1'), p('あ', '2')]))).toBe(false)
  })
})
