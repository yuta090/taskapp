import { describe, it, expect } from 'vitest'
import {
  calculateMilestoneRisk,
  calculateVelocity,
} from '@/lib/risk/calculateRisk'
import type { Task, Milestone } from '@/types/database'

// #89: リスク判定の誤アラームを修正する。
// - 新規案件(velocity データ不足) を赤にしない → 中立(unknown)
// - クライアント起因ブロックを赤にしない → 非赤(ボール反映)
// - 通常の遅延は赤のまま
// - velocity は無関係な updated_at 変更に鈍感（completed_at 基準）

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'ms1',
    org_id: 'o1',
    space_id: 's1',
    name: 'M1',
    start_date: null,
    due_date: null,
    order_key: 1,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: 'ms1',
    parent_task_id: null,
    title: 'T',
    description: null,
    status: 'todo',
    priority: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    decision_state: null,
    client_scope: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    completed_at: null,
    estimated_cost: null,
    estimate_status: null,
    actual_hours: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Task
}

// ローカルタイムゾーンで YYYY-MM-DD（toISOString の UTC ずれを避ける）
function toLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
function futureDue(days = 10): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toLocalDate(d)
}
function pastDue(days = 5): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return toLocalDate(d)
}

describe('calculateMilestoneRisk: 誤アラーム修正 (#89)', () => {
  it('新規案件(velocity=0・期限は未来)は赤にせず中立(unknown)にする', () => {
    const ms = makeMilestone({ due_date: futureDue(10) })
    const tasks = [makeTask({ status: 'todo', ball: 'internal' })]
    const r = calculateMilestoneRisk(ms, tasks, 0)
    expect(r.level).not.toBe('high')
    expect(r.level).toBe('unknown')
    expect(r.insufficientData).toBe(true)
  })

  it('残タスクが全て顧客待ち(allClientBlocked)なら赤にしない（非赤・ボール反映）', () => {
    const ms = makeMilestone({ due_date: futureDue(2) }) // 締切が近くても
    const tasks = [
      makeTask({ id: 'a', status: 'todo', ball: 'client' }),
      makeTask({ id: 'b', status: 'in_progress', ball: 'client' }),
    ]
    const r = calculateMilestoneRisk(ms, tasks, 1) // velocity 十分でも
    expect(r.allClientBlocked).toBe(true)
    expect(r.level).not.toBe('high')
  })

  it('通常の遅延（社内残・ペース不足）は赤(high)のまま', () => {
    const ms = makeMilestone({ due_date: futureDue(2) })
    // 残10件・velocity 0.5件/日 → 必要20日 > 残2日 → ratio>1.5
    const tasks = Array.from({ length: 10 }, (_, i) =>
      makeTask({ id: `t${i}`, status: 'todo', ball: 'internal' })
    )
    const r = calculateMilestoneRisk(ms, tasks, 0.5)
    expect(r.level).toBe('high')
  })

  it('期限超過（社内残あり・顧客待ちでない）は赤(high)', () => {
    const ms = makeMilestone({ due_date: pastDue(3) })
    const tasks = [makeTask({ status: 'todo', ball: 'internal' })]
    const r = calculateMilestoneRisk(ms, tasks, 1)
    expect(r.level).toBe('high')
  })

  it('期限超過でも全て顧客待ちなら赤にしない（自社のせいにしない）', () => {
    const ms = makeMilestone({ due_date: pastDue(3) })
    const tasks = [makeTask({ status: 'todo', ball: 'client' })]
    const r = calculateMilestoneRisk(ms, tasks, 1)
    expect(r.allClientBlocked).toBe(true)
    expect(r.level).not.toBe('high')
  })

  it('全タスク完了は none', () => {
    const ms = makeMilestone({ due_date: futureDue(5) })
    const tasks = [makeTask({ status: 'done' })]
    const r = calculateMilestoneRisk(ms, tasks, 1)
    expect(r.level).toBe('none')
  })

  it('期限未設定は中立(unknown)＋データ不足フラグ', () => {
    const ms = makeMilestone({ due_date: null })
    const tasks = [makeTask({ status: 'todo' })]
    const r = calculateMilestoneRisk(ms, tasks, 1)
    expect(r.level).toBe('unknown')
    expect(r.insufficientData).toBe(true)
  })
})

describe('calculateVelocity: updated_at 変更に鈍感 (#89)', () => {
  it('古い完了タスクを最近編集(updated_at 更新)しても velocity に混入しない', () => {
    // completed_at は30日前、updated_at は今日 → 14日窓には入れない
    const old = new Date()
    old.setDate(old.getDate() - 30)
    const tasks = [
      makeTask({
        id: 'done-old',
        status: 'done',
        completed_at: old.toISOString(),
        updated_at: new Date().toISOString(),
      }),
    ]
    expect(calculateVelocity(tasks, 14)).toBe(0)
  })

  it('最近(窓内)completed_at のタスクは velocity に計上する', () => {
    const recent = new Date()
    recent.setDate(recent.getDate() - 2)
    const tasks = [
      makeTask({
        id: 'done-recent',
        status: 'done',
        completed_at: recent.toISOString(),
        updated_at: recent.toISOString(),
      }),
    ]
    expect(calculateVelocity(tasks, 14)).toBeCloseTo(1 / 14)
  })

  it('completed_at が無い done タスクは(日付不明として)計上しない', () => {
    const tasks = [
      makeTask({
        id: 'done-nodate',
        status: 'done',
        completed_at: null,
        updated_at: new Date().toISOString(),
      }),
    ]
    expect(calculateVelocity(tasks, 14)).toBe(0)
  })
})
