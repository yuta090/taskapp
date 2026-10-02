import { describe, it, expect } from 'vitest'
import type { Task } from '@/types/database'
import {
  classifyFollowUps,
  daysUntil,
  FOLLOW_UP_URGENT_DAYS,
  FOLLOW_UP_WARN_DAYS,
  formatDueDays,
  upcomingDeadlines,
  UPCOMING_DEADLINE_LIMIT,
} from './followUps'

const TODAY = '2026-09-16'
const NOW = new Date('2026-09-16T00:00:00Z')

/** NOW から n 日前の ISO 文字列（待ち日数が n になる updated_at） */
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString()
}

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 't',
    title: overrides.title ?? 'タスク',
    status: 'todo',
    ball: 'client',
    due_date: null,
    updated_at: daysAgo(0),
    ...overrides,
  } as Task
}

describe('daysUntil / formatDueDays', () => {
  it('今日は 0、明日は 1、昨日は -1（日付の文字だけで数える）', () => {
    expect(daysUntil('2026-09-16', TODAY)).toBe(0)
    expect(daysUntil('2026-09-17', TODAY)).toBe(1)
    expect(daysUntil('2026-09-15', TODAY)).toBe(-1)
  })

  it('期限の時刻が付いていても日付の部分だけを使う', () => {
    expect(daysUntil('2026-09-16T23:59:00+09:00', TODAY)).toBe(0)
  })

  it('言葉にする: 期限なし・超過・今日・N日後', () => {
    expect(formatDueDays(null)).toBe('期限なし')
    expect(formatDueDays(-3)).toBe('3日超過')
    expect(formatDueDays(0)).toBe('今日')
    expect(formatDueDays(4)).toBe('4日後')
  })
})

describe('classifyFollowUps — クライアント確認が必要なタスク', () => {
  it('しきい値は 警告5日・要フォロー7日', () => {
    expect(FOLLOW_UP_WARN_DAYS).toBe(5)
    expect(FOLLOW_UP_URGENT_DAYS).toBe(7)
  })

  it('ボールが社内のタスクと完了したタスクは入らない', () => {
    const items = classifyFollowUps(
      [
        task({ id: 'a', ball: 'internal', updated_at: daysAgo(30) }),
        task({ id: 'b', status: 'done', updated_at: daysAgo(30) }),
      ],
      TODAY,
      NOW
    )
    expect(items).toEqual([])
  })

  it('待ちが5日未満で期限が8日以上先（または無し）なら入らない', () => {
    const items = classifyFollowUps(
      [
        task({ id: 'a', updated_at: daysAgo(4), due_date: '2026-09-24' }),
        task({ id: 'b', updated_at: daysAgo(4), due_date: null }),
      ],
      TODAY,
      NOW
    )
    expect(items).toEqual([])
  })

  it('期限切れは待ち日数に関係なく urgent', () => {
    const [item] = classifyFollowUps([task({ due_date: '2026-09-15', updated_at: daysAgo(0) })], TODAY, NOW)
    expect(item).toMatchObject({ level: 'urgent', staleDays: 0, dueDaysLeft: -1 })
  })

  it('urgent の境界: 待ち7日以上かつ期限まで3日以内（3日後は urgent・4日後は warn）', () => {
    const items = classifyFollowUps(
      [
        task({ id: 'u', updated_at: daysAgo(7), due_date: '2026-09-19' }),
        task({ id: 'w', updated_at: daysAgo(7), due_date: '2026-09-20' }),
      ],
      TODAY,
      NOW
    )
    expect(items.find((i) => i.task.id === 'u')?.level).toBe('urgent')
    expect(items.find((i) => i.task.id === 'w')?.level).toBe('warn')
  })

  it('待ちが6日で期限が3日後なら urgent ではなく warn', () => {
    const [item] = classifyFollowUps([task({ updated_at: daysAgo(6), due_date: '2026-09-19' })], TODAY, NOW)
    expect(item.level).toBe('warn')
  })

  it('warn の境界: 待ち5日以上、または期限が7日以内', () => {
    const items = classifyFollowUps(
      [
        task({ id: 'stale5', updated_at: daysAgo(5) }),
        task({ id: 'due7', due_date: '2026-09-23' }),
        task({ id: 'due8', due_date: '2026-09-24' }),
        task({ id: 'stale4', updated_at: daysAgo(4) }),
      ],
      TODAY,
      NOW
    )
    expect(items.map((i) => i.task.id).sort()).toEqual(['due7', 'stale5'])
    expect(items.every((i) => i.level === 'warn')).toBe(true)
  })

  it('待ち日数は getClientWaitingDays と同じ（経過時間の切り捨て）', () => {
    const [item] = classifyFollowUps([task({ updated_at: new Date(NOW.getTime() - 5.9 * 86_400_000).toISOString() })], TODAY, NOW)
    expect(item.staleDays).toBe(5)
  })

  it('期限なしは dueDaysLeft が null', () => {
    const [item] = classifyFollowUps([task({ updated_at: daysAgo(6), due_date: null })], TODAY, NOW)
    expect(item.dueDaysLeft).toBeNull()
  })

  it('並びは urgent が先、同じ level の中は待ち日数の長い順', () => {
    const items = classifyFollowUps(
      [
        task({ id: 'w10', updated_at: daysAgo(10) }),
        task({ id: 'w6', updated_at: daysAgo(6) }),
        task({ id: 'u1', due_date: '2026-09-10', updated_at: daysAgo(1) }),
        task({ id: 'u9', due_date: '2026-09-10', updated_at: daysAgo(9) }),
      ],
      TODAY,
      NOW
    )
    expect(items.map((i) => i.task.id)).toEqual(['u9', 'u1', 'w10', 'w6'])
  })
})

describe('upcomingDeadlines — 期限が近いタスク', () => {
  const t = (id: string, due: string | null, status: Task['status'] = 'todo') =>
    task({ id, due_date: due, status, ball: 'internal' })

  it('期限が7日以内（期限切れを含む）の未完了だけを、期限の近い順に出す', () => {
    const items = upcomingDeadlines(
      [
        t('later', '2026-09-24'),
        t('week', '2026-09-23'),
        t('today', '2026-09-16'),
        t('over', '2026-09-10'),
        t('done', '2026-09-17', 'done'),
        t('none', null),
      ],
      TODAY
    )
    expect(items.map((i) => [i.task.id, i.daysLeft])).toEqual([
      ['over', -6],
      ['today', 0],
      ['week', 7],
    ])
  })

  it('8件まで', () => {
    expect(UPCOMING_DEADLINE_LIMIT).toBe(8)
    const many = Array.from({ length: 12 }, (_, i) => t(`t${i}`, `2026-09-${String(10 + i % 6).padStart(2, '0')}`))
    expect(upcomingDeadlines(many, TODAY)).toHaveLength(8)
  })
})
