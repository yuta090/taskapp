import { describe, expect, it } from 'vitest'
import { mergeNewestFirst, toInboxItem, type InboxRow } from './inbox'

function row(over: Partial<InboxRow>): InboxRow {
  return {
    id: 'n1',
    org_id: 'o1',
    space_id: 's1',
    type: 'ball_passed',
    payload: { task_id: 't1', message: '「ロゴ案」のボールが渡されました' },
    created_at: '2026-09-28T01:00:00Z',
    read_at: null,
    actioned_at: null,
    spaces: { name: 'A社サイト' },
    ...over,
  }
}

describe('toInboxItem', () => {
  it('Web のプッシュ通知と同じ見出し・本文にする', () => {
    const item = toInboxItem(row({}))
    expect(item.title).toBe('ボールがあなたに渡されました')
    expect(item.body).toBe('「ロゴ案」のボールが渡されました')
  })
  it('開く先のタスクとプロジェクト名を持つ', () => {
    const item = toInboxItem(row({}))
    expect(item.taskId).toBe('t1')
    expect(item.spaceName).toBe('A社サイト')
  })
  it('未読・対応待ちを見分ける', () => {
    expect(toInboxItem(row({})).unread).toBe(true)
    expect(toInboxItem(row({ read_at: '2026-09-28T02:00:00Z' })).unread).toBe(false)
    expect(toInboxItem(row({})).needsAction).toBe(true)
    expect(toInboxItem(row({ actioned_at: '2026-09-28T02:00:00Z' })).needsAction).toBe(false)
    expect(toInboxItem(row({ type: 'comment_added' })).needsAction).toBe(false)
  })
  it('タスクに結びつかない通知は taskId が null', () => {
    expect(toInboxItem(row({ type: 'invite_accepted', payload: {} })).taskId).toBeNull()
  })
})

describe('mergeNewestFirst', () => {
  it('新着と未読の両方にある通知は1件にまとめ、新しい順に並べる', () => {
    const a = row({ id: 'a', created_at: '2026-09-28T01:00:00Z' })
    const b = row({ id: 'b', created_at: '2026-09-28T03:00:00Z' })
    const c = row({ id: 'c', created_at: '2026-09-27T01:00:00Z' })
    expect(mergeNewestFirst([a, b], [a, c]).map((n) => n.id)).toEqual(['b', 'a', 'c'])
  })
})
