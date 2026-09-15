import { describe, expect, it } from 'vitest'
import { buildTaskLineBlock, findTopLevelAncestor, formatDueLabel } from '@/lib/minutes/taskLine'
import { parseTaskMetaMarker, serializeMinutesBlocks } from '@/lib/minutes/markdown'

const ORG = '00000000-0000-0000-0000-000000000001'
const SPACE = '00000000-0000-0000-0000-000000000010'
const PAGE = '11111111-2222-3333-4444-555555555555'
const USER = '22222222-3333-4444-5555-666666666666'
const MILESTONE = '77777777-8888-9999-aaaa-bbbbbbbbbbbb'

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

describe('担当者とマイルストーンの印', () => {
  it('担当者を選ぶと、名前の見える印が行の末尾に付く', () => {
    const out = md(
      buildTaskLineBlock({ title: '見積を出す', assignee: { id: USER, name: '田中' } }, ORG, SPACE)
    )
    expect(out).toBe(`- [ ] 見積を出す <!--assignee:${USER} 田中-->`)
  })

  it('マイルストーンを選ぶと、名前の見える印が行の末尾に付く', () => {
    const out = md(
      buildTaskLineBlock({ title: '見積を出す', milestone: { id: MILESTONE, name: '第1弾' } }, ORG, SPACE)
    )
    expect(out).toBe(`- [ ] 見積を出す <!--milestone:${MILESTONE} 第1弾-->`)
  })

  it('両方選んだら、担当者・マイルストーンの順に並ぶ', () => {
    const out = md(
      buildTaskLineBlock(
        {
          title: '見積を出す',
          due: '2026-09-20',
          assignee: { id: USER, name: '田中' },
          milestone: { id: MILESTONE, name: '第1弾' },
        },
        ORG,
        SPACE
      )
    )
    expect(out).toBe(
      `- [ ] 見積を出す（期限: 9/20） <!--assignee:${USER} 田中--> <!--milestone:${MILESTONE} 第1弾-->`
    )
  })

  it('名前に > が入っていても印を壊さない', () => {
    const out = md(
      buildTaskLineBlock({ title: '見積を出す', assignee: { id: USER, name: '田<中>' } }, ORG, SPACE)
    )
    expect(out).toBe(`- [ ] 見積を出す <!--assignee:${USER} 田中-->`)
  })

  it('印の中身は ID と名前に分けて読み取れる', () => {
    expect(parseTaskMetaMarker(`${USER} 田中`)).toEqual({ id: USER, name: '田中' })
  })

  it('名前が無い印でも ID だけは読み取れる', () => {
    expect(parseTaskMetaMarker(USER)).toEqual({ id: USER, name: '' })
  })

  it('ID の形をしていない印は読み取らない', () => {
    expect(parseTaskMetaMarker('だれか')).toBeNull()
  })

  /**
   * 読む側は UUID しか通さない。書く側が通してしまうと、保存して読み直したときに
   * 生の `<!--assignee:...-->` が本文に出る（印にならず、ただの文字として残るため）。
   */
  it('ID が UUID の形でなければ、印そのものを書かない', () => {
    const out = md(
      buildTaskLineBlock({ title: '見積を出す', assignee: { id: 'user-1', name: '田中' } }, ORG, SPACE)
    )
    expect(out).toBe('- [ ] 見積を出す')
  })

  it('名前に丸括弧が入っていても印は壊れない', () => {
    const out = md(
      buildTaskLineBlock({ title: '見積を出す', assignee: { id: USER, name: '田中（営業）' } }, ORG, SPACE)
    )
    expect(out).toBe(`- [ ] 見積を出す <!--assignee:${USER} 田中（営業）-->`)
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
