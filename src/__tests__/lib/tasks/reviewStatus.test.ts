import { describe, it, expect } from 'vitest'
import { splitEmbeddedReviews } from '@/lib/tasks/reviewStatus'

/**
 * マイタスクで、社内承認を依頼済み・承認済みのタスクにも「社内承認を依頼」ボタンが出ていた。
 * 一覧が承認の状態を読んでいなかったため。タスクと一緒に reviews を読み、状態を取り出す。
 *
 * reviews は task_id が一意（1タスク1行）なので、Supabase の自動APIは配列ではなく
 * 「オブジェクト or null」で返す（本番で確認済み）。配列を前提にすると一覧の読み込みごと落ちる。
 */
describe('splitEmbeddedReviews', () => {
  it('本番の形（1対1＝オブジェクト）で返ってきた承認の状態を取り出す', () => {
    const { reviewStatuses } = splitEmbeddedReviews([
      { id: 't1', title: '見積もり', reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' } },
      { id: 't2', title: '請求書', reviews: { status: 'approved', created_at: '2026-09-02T00:00:00Z' } },
    ])
    expect(reviewStatuses).toEqual({ t1: 'open', t2: 'approved' })
  })

  it('承認を依頼していないタスク（null・空・項目なし）は状態を持たない', () => {
    const { reviewStatuses } = splitEmbeddedReviews([
      { id: 't1', title: 'A', reviews: null },
      { id: 't2', title: 'B', reviews: [] },
      { id: 't3', title: 'C' },
    ])
    expect(reviewStatuses).toEqual({})
  })

  it('配列の形で返ってきても扱え、そのときはいちばん新しいものを使う', () => {
    const { reviewStatuses } = splitEmbeddedReviews([
      {
        id: 't1',
        title: '見積もり',
        reviews: [
          { status: 'changes_requested', created_at: '2026-09-01T00:00:00Z' },
          { status: 'open', created_at: '2026-09-05T00:00:00Z' },
        ],
      },
    ])
    expect(reviewStatuses).toEqual({ t1: 'open' })
  })

  it('タスク本体からは reviews を取り除き、ほかの項目はそのまま返す', () => {
    const { tasks } = splitEmbeddedReviews([
      { id: 't1', title: 'A', reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' } },
      { id: 't2', title: 'B', reviews: null },
    ])
    expect(tasks).toEqual([
      { id: 't1', title: 'A' },
      { id: 't2', title: 'B' },
    ])
  })
})
