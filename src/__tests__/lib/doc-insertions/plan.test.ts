import { describe, it, expect } from 'vitest'
import { planInsertionSync } from '@/lib/doc-insertions/plan'
import type { DocInsertion } from '@/lib/doc-insertions/logic'

type Blk = { id: string; type: string; props?: Record<string, unknown>; children?: Blk[]; text?: string }
const p = (id: string, text: string): Blk => ({ id, type: 'paragraph', text })
const ins = (id: string, insertionId: string): Blk => ({ id, type: 'docInsertion', props: { insertionId } })
const row = (id: string, over: Partial<DocInsertion> = {}): DocInsertion => ({
  id, org_id: 'o', space_id: 's', wiki_page_id: null, meeting_id: 'm', kind: 'paragraph', content: '本文',
  anchor: null, status: 'pending', anchor_missed: false, author_id: 'u', author_name: '鈴木', created_at: '2026-09-26T05:30:00Z',
  ...over,
})
// 議事録は「その行の Markdown」で、Wiki はブロックの id で足す場所を探す。ここでは本文の文字で探す
const matches = (b: Blk, anchor: string) => b.text === anchor

describe('planInsertionSync', () => {
  it('反映待ちで本文に無いものは、足す場所の行の後ろに入れる', () => {
    const plan = planInsertionSync([p('b1', 'A'), p('b2', 'B')], [row('i1', { anchor: 'A' })], matches)
    expect(plan.insert).toEqual([{ row: expect.objectContaining({ id: 'i1' }), afterBlockId: 'b1', missed: false }])
    expect(plan.markApplied).toEqual([])
  })

  it('足す場所が null（末尾）なら最後の行の後ろ', () => {
    const plan = planInsertionSync([p('b1', 'A'), p('b2', 'B')], [row('i1')], matches)
    expect(plan.insert[0]).toMatchObject({ afterBlockId: 'b2', missed: false })
  })

  it('足す場所が見つからなければ末尾に付けて「見つからなかった」印を立てる', () => {
    const plan = planInsertionSync([p('b1', 'A')], [row('i1', { anchor: '消された行' })], matches)
    expect(plan.insert[0]).toMatchObject({ afterBlockId: 'b1', missed: true })
  })

  it('同じ場所に2つ足すときは、先に出した方が上に来る（後の方を先の後ろに入れる）', () => {
    const plan = planInsertionSync([p('b1', 'A'), p('b2', 'B')], [row('i1', { anchor: 'A' }), row('i2', { anchor: 'A' })], matches)
    expect(plan.insert.map((x) => [x.row.id, x.afterBlockId])).toEqual([['i1', 'b1'], ['i2', 'i1']])
  })

  it('反映待ちでも本文にもう入っていれば、入れずに反映済みにする（二重に入れない）', () => {
    const plan = planInsertionSync([p('b1', 'A'), ins('b9', 'i1')], [row('i1', { anchor: 'A' })], matches)
    expect(plan.insert).toEqual([])
    expect(plan.markApplied).toEqual(['i1'])
  })

  it('字下げした子の中に入っていても見つける', () => {
    const plan = planInsertionSync([{ ...p('b1', 'A'), children: [ins('b9', 'i1')] }], [row('i1')], matches)
    expect(plan.markApplied).toEqual(['i1'])
  })

  it('削除依頼は、本文にあれば消し、無ければ削除済みにする', () => {
    const plan = planInsertionSync(
      [p('b1', 'A'), ins('b9', 'i1')],
      [row('i1', { status: 'remove_requested' }), row('i2', { status: 'remove_requested' })],
      matches
    )
    expect(plan.remove).toEqual(['b9'])
    expect(plan.markRemoved).toEqual(['i2'])
  })
})
