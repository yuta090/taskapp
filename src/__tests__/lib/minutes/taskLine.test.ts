import { describe, expect, it } from 'vitest'
import { buildTaskLineBlock, findTopLevelAncestor, formatDueLabel } from '@/lib/minutes/taskLine'
import { serializeMinutesBlocks } from '@/lib/minutes/markdown'

const ORG = '00000000-0000-0000-0000-000000000001'
const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '11111111-2222-3333-4444-555555555555'

function md(block: ReturnType<typeof buildTaskLineBlock>): string {
  return serializeMinutesBlocks([block])
}

describe('タスクにする行を組み立てる', () => {
  it('やることだけなら、ただの未チェックの行になる', () => {
    expect(md(buildTaskLineBlock({ title: '見積を出す' }, ORG, SPACE))).toBe('- [ ] 見積を出す')
  })

  it('前後の空白は落とす', () => {
    expect(md(buildTaskLineBlock({ title: '  見積を出す  ' }, ORG, SPACE))).toBe('- [ ] 見積を出す')
  })

  it('期限を入れると、読み取れる形で末尾に付く', () => {
    expect(md(buildTaskLineBlock({ title: '見積を出す', due: '2026-09-20' }, ORG, SPACE))).toBe(
      '- [ ] 見積を出す（期限: 9/20）'
    )
  })

  it('年をまたぐ期限は年も書く', () => {
    expect(md(buildTaskLineBlock({ title: '棚卸し', due: '2027-01-05' }, ORG, SPACE))).toBe(
      '- [ ] 棚卸し（期限: 2027/1/5）'
    )
  })

  it('資料のページを選ぶと、そのページへのリンクが入る', () => {
    const out = md(
      buildTaskLineBlock({ title: '間取りを決める', page: { id: PAGE, title: '新社屋の間取り' } }, ORG, SPACE)
    )
    expect(out).toBe(
      `- [ ] 間取りを決める [新社屋の間取り](/${ORG}/project/${SPACE}/wiki?page=${PAGE})`
    )
  })

  it('資料と期限の両方を入れても、期限は末尾に来る', () => {
    const out = md(
      buildTaskLineBlock(
        { title: '間取りを決める', due: '2026-09-20', page: { id: PAGE, title: '新社屋の間取り' } },
        ORG,
        SPACE
      )
    )
    expect(out).toBe(
      `- [ ] 間取りを決める [新社屋の間取り](/${ORG}/project/${SPACE}/wiki?page=${PAGE})（期限: 9/20）`
    )
  })

  it('やることが空なら作らない', () => {
    expect(buildTaskLineBlock({ title: '   ' }, ORG, SPACE)).toBeNull()
  })
})

describe('行を入れる場所（字下げされない場所に置く）', () => {
  const doc = [
    { id: 'a', children: [] },
    { id: 'b', children: [{ id: 'b1', children: [{ id: 'b2', children: [] }] }] },
    { id: 'c', children: [] },
  ]

  it('入れ子の中にカーソルがあっても、その大元の行を返す', () => {
    expect(findTopLevelAncestor(doc, 'b2')?.id).toBe('b')
  })

  it('最上位にカーソルがあればそのまま', () => {
    expect(findTopLevelAncestor(doc, 'c')?.id).toBe('c')
  })

  it('見つからなければ最後の行を返す（末尾に足す）', () => {
    expect(findTopLevelAncestor(doc, 'どこにも無い')?.id).toBe('c')
    expect(findTopLevelAncestor(doc, undefined)?.id).toBe('c')
  })

  it('空の文書なら null', () => {
    expect(findTopLevelAncestor([], 'a')).toBeNull()
  })
})

describe('期限の見せ方', () => {
  it('同じ年なら月日だけ', () => {
    expect(formatDueLabel('2026-09-20', new Date(2026, 8, 15))).toBe('9/20')
  })

  it('年が違えば年も出す', () => {
    expect(formatDueLabel('2027-01-05', new Date(2026, 8, 15))).toBe('2027/1/5')
  })

  it('形が違えば何も出さない', () => {
    expect(formatDueLabel('こわれた', new Date(2026, 8, 15))).toBeNull()
    expect(formatDueLabel('', new Date(2026, 8, 15))).toBeNull()
  })
})
