import { describe, it, expect } from 'vitest'
import { summarizeWeek, weekStartOf, toJstYmd } from '@/lib/dashboard/weekHighlights'
import type { Task } from '@/types/database'

/**
 * ダッシュボードの「今週」。月曜はじまりで、今週と先週の動きを数える。日付は日本時間で切る。
 */

function task(overrides: Partial<Task>): Task {
  return {
    id: 't',
    title: 'タスク',
    status: 'todo',
    created_at: '2026-08-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  } as Task
}

// 2026-09-16 は水曜。今週は 9/14(月)〜9/20(日)、先週は 9/7〜9/13
const TODAY = '2026-09-16'

describe('weekStartOf / toJstYmd', () => {
  it('月曜はじまり。日曜はその週の最後の日', () => {
    expect(weekStartOf('2026-09-16')).toBe('2026-09-14')
    expect(weekStartOf('2026-09-14')).toBe('2026-09-14')
    expect(weekStartOf('2026-09-20')).toBe('2026-09-14')
  })

  it('日本時間の日付に直す（UTC の前日 15時以降は翌日）', () => {
    expect(toJstYmd('2026-09-13T15:00:00Z')).toBe('2026-09-14')
    expect(toJstYmd('2026-09-13T14:59:59Z')).toBe('2026-09-13')
  })
})

describe('summarizeWeek', () => {
  const base = { today: TODAY, tasks: [] as Task[], wikiPages: [], meetings: [], decisionEvents: [] }

  it('完了・新規タスクを今週と先週で数え、日ごとの内訳を月〜日で出す', () => {
    const s = summarizeWeek({
      ...base,
      tasks: [
        // 日本時間 9/14(月) 0時 → 今週
        task({ id: 'c1', status: 'done', completed_at: '2026-09-13T15:00:00Z' }),
        task({ id: 'c2', status: 'done', completed_at: '2026-09-16T03:00:00Z' }),
        task({ id: 'c-prev', status: 'done', completed_at: '2026-09-10T03:00:00Z' }),
        task({ id: 'n1', created_at: '2026-09-15T03:00:00Z' }),
        task({ id: 'n-prev', created_at: '2026-09-08T03:00:00Z' }),
      ],
    })
    expect(s.weekStart).toBe('2026-09-14')
    expect(s.stats.completedTasks).toEqual({ current: 2, previous: 1 })
    expect(s.stats.createdTasks).toEqual({ current: 1, previous: 1 })
    expect(s.days.map((d) => d.date)).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20',
    ])
    expect(s.days.map((d) => d.completed)).toEqual([1, 0, 1, 0, 0, 0, 0])
    expect(s.days.map((d) => d.created)).toEqual([0, 1, 0, 0, 0, 0, 0])
    expect(s.lists.completed.map((t) => t.id)).toEqual(['c2', 'c1'])
  })

  it('完了日の記録が無い完了タスクは数えない', () => {
    const s = summarizeWeek({ ...base, tasks: [task({ status: 'done', completed_at: null })] })
    expect(s.stats.completedTasks.current).toBe(0)
  })

  it('Wiki は今週作ったものと、前からあって今週更新したものを分けて数える', () => {
    const s = summarizeWeek({
      ...base,
      wikiPages: [
        { id: 'w1', title: '新しいページ', created_at: '2026-09-15T01:00:00Z', updated_at: '2026-09-16T01:00:00Z' },
        { id: 'w2', title: '前からのページ', created_at: '2026-08-01T01:00:00Z', updated_at: '2026-09-15T01:00:00Z' },
        { id: 'w3', title: '先週作ったページ', created_at: '2026-09-08T01:00:00Z', updated_at: '2026-09-08T01:00:00Z' },
        { id: 'w4', title: '触っていないページ', created_at: '2026-08-01T01:00:00Z', updated_at: '2026-08-02T01:00:00Z' },
      ],
    })
    expect(s.stats.wikiCreated).toEqual({ current: 1, previous: 1 })
    expect(s.stats.wikiUpdated.current).toBe(1)
    expect(s.lists.wikiCreated.map((p) => p.id)).toEqual(['w1'])
    expect(s.lists.wikiUpdated.map((p) => p.id)).toEqual(['w2'])
  })

  it('会議は今週の今日までに開いたものを数える（これからの予定は入れない）', () => {
    const s = summarizeWeek({
      ...base,
      meetings: [
        { id: 'm1', title: '定例', held_at: '2026-09-15T01:00:00Z', status: 'ended' },
        { id: 'm2', title: '来週の準備', held_at: '2026-09-18T01:00:00Z', status: 'planned' },
        { id: 'm3', title: '先週の定例', held_at: '2026-09-08T01:00:00Z', status: 'ended' },
        { id: 'm4', title: '日付なし', held_at: null, status: 'planned' },
      ],
    })
    expect(s.stats.meetingsHeld).toEqual({ current: 1, previous: 1 })
    expect(s.lists.meetings.map((m) => m.id)).toEqual(['m1'])
  })

  it('確定事項は「決定」の記録をタスク単位で数える', () => {
    const s = summarizeWeek({
      ...base,
      decisionEvents: [
        { task_id: 'a', action: 'SPEC_DECIDE', created_at: '2026-09-15T01:00:00Z' },
        { task_id: 'a', action: 'SPEC_DECIDE', created_at: '2026-09-16T01:00:00Z' },
        { task_id: 'b', action: 'SPEC_IMPLEMENT', created_at: '2026-09-16T01:00:00Z' },
        { task_id: 'c', action: 'SPEC_DECIDE', created_at: '2026-09-09T01:00:00Z' },
      ],
    })
    expect(s.stats.decisions).toEqual({ current: 1, previous: 1 })
    expect(s.lists.decidedTaskIds).toEqual(['a'])
  })
})
