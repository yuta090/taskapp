import { describe, it, expect } from 'vitest'
import type { Task } from '@/types/database'
import {
  decidedAtByTask,
  decisionProgressLabel,
  formatDecidedDate,
  summarizeDecisions,
  type DecisionEventRow,
} from './decisions'

function task(overrides: Partial<Task>): Task {
  return {
    id: 't',
    title: '決定事項',
    status: 'todo',
    type: 'spec',
    decision_state: 'decided',
    updated_at: '2026-09-10T00:00:00Z',
    ...overrides,
  } as Task
}

function event(overrides: Partial<DecisionEventRow>): DecisionEventRow {
  return { task_id: 't', action: 'SPEC_DECIDE', created_at: '2026-09-10T00:00:00Z', ...overrides }
}

describe('decidedAtByTask — 確定の記録から「いつ決まったか」を引く', () => {
  it('タスクごとに一番新しい記録を採る（決定のあと実装済みにしたら、あとの日付）', () => {
    const map = decidedAtByTask([
      event({ task_id: 'a', action: 'SPEC_DECIDE', created_at: '2026-09-01T00:00:00Z' }),
      event({ task_id: 'a', action: 'SPEC_IMPLEMENT', created_at: '2026-09-05T00:00:00Z' }),
      event({ task_id: 'b', created_at: '2026-09-03T00:00:00Z' }),
    ])
    expect(map.get('a')).toBe('2026-09-05T00:00:00Z')
    expect(map.get('b')).toBe('2026-09-03T00:00:00Z')
  })

  it('記録が1件も無ければ空', () => {
    expect(decidedAtByTask([]).size).toBe(0)
  })
})

describe('summarizeDecisions — 確定事項の一覧を作る', () => {
  it('決まったもの（決定済み・実装済み）を、確定した日の新しい順に出す', () => {
    const tasks = [
      task({ id: 'a', title: '見積の出し方', decision_state: 'decided' }),
      task({ id: 'b', title: '納品の形式', decision_state: 'implemented' }),
      task({ id: 'plain', title: 'ふつうのタスク', type: 'task', decision_state: null }),
    ]
    const events = [
      event({ task_id: 'a', created_at: '2026-09-01T00:00:00Z' }),
      event({ task_id: 'b', created_at: '2026-09-12T00:00:00Z' }),
    ]

    const summary = summarizeDecisions(tasks, events)

    expect(summary.decided.map((d) => d.task.id)).toEqual(['b', 'a'])
    expect(summary.decided[0].decidedAt).toBe('2026-09-12T00:00:00Z')
  })

  it('確定の記録が無いもの（古くて読み込みの範囲外）は、最後に更新した日で並べ、日付は出さない', () => {
    const tasks = [
      task({ id: 'old', decision_state: 'decided', updated_at: '2026-08-01T00:00:00Z' }),
      task({ id: 'new', decision_state: 'decided', updated_at: '2026-09-15T00:00:00Z' }),
    ]

    const summary = summarizeDecisions(tasks, [])

    expect(summary.decided.map((d) => d.task.id)).toEqual(['new', 'old'])
    expect(summary.decided[0].decidedAt).toBeNull()
  })

  it('まだ決まっていないもの（検討中）は別に分ける。完了したものは出さない', () => {
    const tasks = [
      task({ id: 'c1', title: '請求のタイミング', decision_state: 'considering', updated_at: '2026-09-02T00:00:00Z' }),
      task({ id: 'c2', title: '保守の範囲', decision_state: 'considering', updated_at: '2026-09-08T00:00:00Z' }),
      task({ id: 'c3', title: '取り下げた検討', decision_state: 'considering', status: 'done' }),
      task({ id: 'none', title: '状態が入っていない決定事項', decision_state: null, updated_at: '2026-09-01T00:00:00Z' }),
    ]

    const summary = summarizeDecisions(tasks, [])

    expect(summary.considering.map((t) => t.id)).toEqual(['c2', 'c1', 'none'])
    expect(summary.decided).toHaveLength(0)
  })

  it('決定事項のタスクが1件も無ければ、どちらも空', () => {
    const summary = summarizeDecisions([task({ id: 'x', type: 'task', decision_state: null })], [])
    expect(summary.decided).toHaveLength(0)
    expect(summary.considering).toHaveLength(0)
  })
})

describe('formatDecidedDate — 確定した日の出し方（日本時間）', () => {
  it('今年なら「9/12」', () => {
    expect(formatDecidedDate('2026-09-12T03:00:00Z', 2026)).toBe('9/12')
  })

  it('年をまたいだら年も出す', () => {
    expect(formatDecidedDate('2025-12-20T03:00:00Z', 2026)).toBe('2025/12/20')
  })

  it('日本時間で日付が変わる（UTC では前日の夜でも、日本では次の日）', () => {
    expect(formatDecidedDate('2026-09-11T20:00:00Z', 2026)).toBe('9/12')
  })
})

describe('decisionProgressLabel — どこまで決まったかを「確定 1/2」で出す', () => {
  it('決まった数と、決定事項のタスクの数を並べる（Wiki 一覧の「確定 2/5」と同じ言い方）', () => {
    const summary = summarizeDecisions(
      [
        task({ id: 'd1', decision_state: 'decided' }),
        task({ id: 'c1', decision_state: 'considering' }),
      ],
      []
    )
    expect(decisionProgressLabel(summary)).toEqual({ text: '確定 1/2', complete: false })
  })

  it('全部決まっていたら complete', () => {
    const summary = summarizeDecisions([task({ id: 'd1', decision_state: 'implemented' })], [])
    expect(decisionProgressLabel(summary)).toEqual({ text: '確定 1/1', complete: true })
  })

  it('決定事項のタスクが1件も無ければ出さない', () => {
    expect(decisionProgressLabel(summarizeDecisions([], []))).toBeNull()
  })
})
