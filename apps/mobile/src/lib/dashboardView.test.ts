import { describe, expect, it } from 'vitest'
import type { Meeting, Milestone, Task } from '@/types/database'
import { buildDashboard, UPCOMING_MEETING_LIMIT } from './dashboardView'

function task(over: Partial<Task>): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    title: 'タスク',
    status: 'todo',
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    milestone_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    ...over,
  } as Task
}

function meeting(over: Partial<Meeting>): Meeting {
  return { id: 'm1', title: '定例', status: 'planned', held_at: null, created_at: '2026-09-01T00:00:00Z', ...over } as Meeting
}

function milestone(over: Partial<Milestone>): Milestone {
  return { id: 'ms1', name: 'リリース', due_date: null, completed_at: null, ...over } as Milestone
}

// 日本時間の 2026-10-03 12:00
const TODAY = '2026-10-03'
const NOW = new Date('2026-10-03T03:00:00Z')

const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const empty = { tasks: [], reviewStatuses: {}, meetings: [], milestones: [], today: TODAY, now: NOW }

describe('buildDashboard — 各区分に1件ずつ', () => {
  const input = {
    ...empty,
    tasks: [
      task({ id: 'active', status: 'in_progress' }),
      task({ id: 'backlog', status: 'backlog' }),
      task({ id: 'review', status: 'in_review' }),
      task({ id: 'openReview', status: 'in_progress' }),
      task({ id: 'wait', ball: 'client', updated_at: daysAgo(6) }),
      task({ id: 'late', status: 'in_progress', due_date: '2026-10-01', milestone_id: 'ms1' }),
      task({ id: 'soon', due_date: '2026-10-05', milestone_id: 'ms1', status: 'done' }),
      task({ id: 'done', status: 'done', ball: 'client', due_date: '2026-09-01', updated_at: daysAgo(20) }),
    ],
    reviewStatuses: { openReview: 'open' as const, active: 'approved' as const },
    milestones: [milestone({ due_date: '2026-10-10' }), milestone({ id: 'closed', completed_at: '2026-09-30T00:00:00Z' })],
  }
  const d = buildDashboard(input)

  it('KPI は Web の絞り込み（アクティブ・未着手・レビュー待ち・クライアント確認待ち）と同じ数え方', () => {
    // active: backlog と done を除く 5 件（soon は done なので除く）
    expect(d.kpi).toEqual({ active: 5, backlog: 1, inReview: 2, clientWait: 1 })
  })

  it('期限切れは完了を除き、承認待ち・クライアント確認待ち・タスクに分ける', () => {
    expect(d.overdueGroups.total).toBe(1)
    expect(d.overdueGroups.task.map((i) => i.task.id)).toEqual(['late'])
    expect(d.overdueGroups.task[0].daysOverdue).toBe(2)
  })

  it('クライアント確認が必要なタスクは、完了を除いて待ち日数で拾う', () => {
    expect(d.followUps.map((i) => [i.task.id, i.level, i.staleDays])).toEqual([['wait', 'warn', 6]])
  })

  it('期限が近いタスクは、完了を除いて期限の近い順', () => {
    expect(d.upcomingDeadlines.map((i) => [i.task.id, i.daysLeft])).toEqual([['late', -2]])
  })

  it('マイルストーンは完了していないものだけ、done/total つき', () => {
    expect(d.milestones).toHaveLength(1)
    expect(d.milestones[0]).toMatchObject({ done: 1, total: 2, pct: 50, daysLeft: 7 })
  })
})

describe('buildDashboard — 直近の予定', () => {
  const at = (days: number, hours = 0) => new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString()

  it('予定（planned）で、今以降のものを、日時の近い順に出す', () => {
    const d = buildDashboard({
      ...empty,
      meetings: [
        meeting({ id: 'later', held_at: at(3) }),
        meeting({ id: 'soon', held_at: at(0, 1) }),
        meeting({ id: 'past', held_at: at(0, -1) }),
        meeting({ id: 'ended', status: 'ended', held_at: at(1) }),
        meeting({ id: 'live', status: 'in_progress', held_at: at(1) }),
        meeting({ id: 'nodate', held_at: null }),
      ],
    })
    expect(d.upcomingMeetings.map((m) => m.id)).toEqual(['soon', 'later'])
  })

  it('5件まで', () => {
    expect(UPCOMING_MEETING_LIMIT).toBe(5)
    const meetings = Array.from({ length: 8 }, (_, i) => meeting({ id: `m${i}`, held_at: at(i + 1) }))
    expect(buildDashboard({ ...empty, meetings }).upcomingMeetings).toHaveLength(5)
  })
})

describe('buildDashboard — 空の入力', () => {
  it('すべて 0 件・空', () => {
    expect(buildDashboard(empty)).toEqual({
      kpi: { active: 0, backlog: 0, inReview: 0, clientWait: 0 },
      overdueGroups: { review: [], client: [], task: [], total: 0 },
      followUps: [],
      upcomingDeadlines: [],
      upcomingMeetings: [],
      milestones: [],
    })
  })
})
