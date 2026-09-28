import { describe, it, expect } from 'vitest'
import {
  mergeReferencingTasks,
  referencingTaskStatusLabel,
  wikiPageLinkPattern,
  type ReferencingTaskRow,
} from '@/lib/wiki/referencingTasks'

// Wiki のページ情報に出す「このページを参照しているタスク」。
// 仕様書連携（tasks.wiki_page_id）と、説明文に貼られたページへのリンクの2つから集める。

function row(overrides: Partial<ReferencingTaskRow> = {}): ReferencingTaskRow {
  return {
    id: 't1',
    org_id: 'org1',
    space_id: 'space1',
    short_id: 1,
    title: 'タスク',
    status: 'todo',
    assignee_id: null,
    ...overrides,
  }
}

describe('wikiPageLinkPattern', () => {
  it('説明文の中のページへのリンク（wiki?page=<id>）を探す ilike の形にする', () => {
    expect(wikiPageLinkPattern('11111111-2222-3333-4444-555555555555')).toBe(
      '%wiki?page=11111111-2222-3333-4444-555555555555%'
    )
  })

  it('ilike の特殊文字（% と _ と \\）は文字どおりに探すよう逃がす', () => {
    expect(wikiPageLinkPattern('a_b%c\\d')).toBe('%wiki?page=a\\_b\\%c\\\\d%')
  })
})

describe('mergeReferencingTasks', () => {
  it('仕様書連携と説明文の両方で見つかったタスクは1件にまとめる', () => {
    const merged = mergeReferencingTasks(
      [row({ id: 't1', short_id: 1 })],
      [row({ id: 't1', short_id: 1 }), row({ id: 't2', short_id: 2 })]
    )
    expect(merged.map((t) => t.id)).toEqual(['t2', 't1'])
  })

  it('未完了を先に、その中は番号の新しい順に並べる。完了は最後', () => {
    const merged = mergeReferencingTasks(
      [
        row({ id: 'done-new', short_id: 9, status: 'done' }),
        row({ id: 'open-old', short_id: 3, status: 'in_progress' }),
      ],
      [row({ id: 'open-new', short_id: 7, status: 'backlog' })]
    )
    expect(merged.map((t) => t.id)).toEqual(['open-new', 'open-old', 'done-new'])
  })

  it('番号がまだ無いタスク（採番前）は同じ状態の中で最後に置く', () => {
    const merged = mergeReferencingTasks([row({ id: 'no-num', short_id: null }), row({ id: 'num', short_id: 2 })], [])
    expect(merged.map((t) => t.id)).toEqual(['num', 'no-num'])
  })

  it('どちらも空なら空', () => {
    expect(mergeReferencingTasks([], [])).toEqual([])
  })
})

describe('referencingTaskStatusLabel', () => {
  it('タスク一覧の行と同じ言葉で状態を出す', () => {
    expect(referencingTaskStatusLabel('backlog')).toBe('バックログ')
    expect(referencingTaskStatusLabel('todo')).toBe('着手予定')
    expect(referencingTaskStatusLabel('in_progress')).toBe('進行中')
    expect(referencingTaskStatusLabel('in_review')).toBe('社内承認中')
    expect(referencingTaskStatusLabel('considering')).toBe('検討中')
    expect(referencingTaskStatusLabel('done')).toBe('完了')
  })
})
