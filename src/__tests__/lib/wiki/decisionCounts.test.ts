import { describe, it, expect } from 'vitest'
import {
  buildDecisionCounts,
  decisionChipLabel,
  type SpecTaskRow,
} from '@/lib/wiki/decisionCounts'

const row = (wiki_page_id: string, decision_state: SpecTaskRow['decision_state']): SpecTaskRow => ({
  wiki_page_id,
  decision_state,
})

describe('buildDecisionCounts', () => {
  it('ページごとに「決定事項のタスクの数」と「確定した数」を数える', () => {
    const counts = buildDecisionCounts([
      row('p1', 'considering'),
      row('p1', 'decided'),
      row('p1', 'implemented'),
      row('p2', 'considering'),
    ])
    expect(counts['p1']).toEqual({ total: 3, decided: 2 })
    expect(counts['p2']).toEqual({ total: 1, decided: 0 })
  })

  it('実装済みも「確定した」に数える（決まったあとの先の話なので）', () => {
    const counts = buildDecisionCounts([row('p1', 'implemented')])
    expect(counts['p1']).toEqual({ total: 1, decided: 1 })
  })

  it('決定事項のタスクが無いページは出てこない', () => {
    const counts = buildDecisionCounts([row('p1', 'considering')])
    expect(counts['p2']).toBeUndefined()
  })

  it('状態が入っていない行も総数には数える（印を実態より良く見せない）', () => {
    const counts = buildDecisionCounts([row('p1', null), row('p1', 'decided')])
    expect(counts['p1']).toEqual({ total: 2, decided: 1 })
  })

  it('ページの指定が無い行は無視する', () => {
    const counts = buildDecisionCounts([
      { wiki_page_id: null, decision_state: 'decided' } as unknown as SpecTaskRow,
      row('p1', 'decided'),
    ])
    expect(Object.keys(counts)).toEqual(['p1'])
  })

  it('空でも落ちない', () => {
    expect(buildDecisionCounts([])).toEqual({})
  })
})

describe('decisionChipLabel', () => {
  it('決定事項のタスクが無ければ印を出さない', () => {
    expect(decisionChipLabel(undefined)).toBeNull()
    expect(decisionChipLabel({ total: 0, decided: 0 })).toBeNull()
  })

  it('途中なら「確定 2/5」', () => {
    expect(decisionChipLabel({ total: 5, decided: 2 })).toEqual({ text: '確定 2/5', complete: false })
  })

  it('全部そろったら塗りつぶす', () => {
    expect(decisionChipLabel({ total: 3, decided: 3 })).toEqual({ text: '確定 3/3', complete: true })
  })

  it('1件も決まっていなくても数は出す（何件決めるのかが分かる）', () => {
    expect(decisionChipLabel({ total: 4, decided: 0 })).toEqual({ text: '確定 0/4', complete: false })
  })
})
