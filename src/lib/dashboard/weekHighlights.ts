import type { Task } from '@/types/database'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import type { DecisionEventRow } from '@/lib/dashboard/decisions'

/**
 * ダッシュボードの「今週」。月曜はじまりの今週と先週の動き（タスクの完了・新規、Wiki の作成・更新、
 * 会議、確定事項）を数える。
 *
 * 日付はすべて日本時間の 'YYYY-MM-DD' で切る。記録の時刻は UTC で届くので、toJstYmd で直してから比べる
 * （直さないと、日本時間の月曜の朝9時より前に終えたタスクが先週に入る）。
 */

export interface WeekWikiPage {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface WeekMeeting {
  id: string
  title: string
  held_at: string | null
  status: string
}

export interface WeekCount {
  current: number
  previous: number
}

export interface WeekSummary {
  weekStart: string
  weekEnd: string
  stats: {
    completedTasks: WeekCount
    createdTasks: WeekCount
    wikiCreated: WeekCount
    /**
     * 前からあるページのうち今週更新したもの。先週の数は出さない
     * （記録が「最後に更新した日」だけなので、今週も更新したページは先週の数から消えてしまう）
     */
    wikiUpdated: { current: number }
    meetingsHeld: WeekCount
    decisions: WeekCount
  }
  /** 今週の月〜日。日ごとの完了・新規タスクの数 */
  days: Array<{ date: string; completed: number; created: number }>
  lists: {
    /** 今週完了したタスク。新しい順 */
    completed: Task[]
    wikiCreated: WeekWikiPage[]
    wikiUpdated: WeekWikiPage[]
    meetings: WeekMeeting[]
    /** 今週「決定」になったタスクの id。新しい順 */
    decidedTaskIds: string[]
  }
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return formatDateToLocalString(new Date(y, m - 1, d + days))
}

/** その週の月曜日 */
export function weekStartOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dayOfWeek = new Date(y, m - 1, d).getDay() // 0=日
  return addDays(ymd, -((dayOfWeek + 6) % 7))
}

/** 先週の月曜。今週と先週を数えるために、ここから後の記録を読む */
export function previousWeekStartOf(ymd: string): string {
  return addDays(weekStartOf(ymd), -7)
}

/** 記録の時刻（ISO 文字列）を日本時間の日付にする */
export function toJstYmd(iso: string): string {
  return formatDateToLocalString(jstNow(new Date(iso)))
}

type Week = 'current' | 'previous' | null

function byNewest<T>(get: (item: T) => string) {
  return (a: T, b: T) => get(b).localeCompare(get(a))
}

export function summarizeWeek({
  today,
  tasks,
  wikiPages,
  meetings,
  decisionEvents,
}: {
  today: string
  tasks: readonly Task[]
  wikiPages: readonly WeekWikiPage[]
  meetings: readonly WeekMeeting[]
  decisionEvents: readonly DecisionEventRow[]
}): WeekSummary {
  const weekStart = weekStartOf(today)
  const weekEnd = addDays(weekStart, 6)
  const prevStart = addDays(weekStart, -7)

  const weekOf = (ymd: string): Week => {
    if (ymd >= weekStart && ymd <= weekEnd) return 'current'
    if (ymd >= prevStart && ymd < weekStart) return 'previous'
    return null
  }
  const count = (): WeekCount => ({ current: 0, previous: 0 })

  const stats = {
    completedTasks: count(),
    createdTasks: count(),
    wikiCreated: count(),
    wikiUpdated: { current: 0 },
    meetingsHeld: count(),
    decisions: count(),
  }
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(weekStart, i), completed: 0, created: 0 }))
  const dayIndex = new Map(days.map((d, i) => [d.date, i]))
  const completed: Task[] = []

  for (const task of tasks) {
    if (task.status === 'done' && task.completed_at) {
      const ymd = toJstYmd(task.completed_at)
      const week = weekOf(ymd)
      if (week) stats.completedTasks[week] += 1
      if (week === 'current') {
        days[dayIndex.get(ymd)!].completed += 1
        completed.push(task)
      }
    }
    const createdYmd = toJstYmd(task.created_at)
    const createdWeek = weekOf(createdYmd)
    if (createdWeek) stats.createdTasks[createdWeek] += 1
    if (createdWeek === 'current') days[dayIndex.get(createdYmd)!].created += 1
  }

  const wikiCreated: WeekWikiPage[] = []
  const wikiUpdated: WeekWikiPage[] = []
  for (const page of wikiPages) {
    const createdWeek = weekOf(toJstYmd(page.created_at))
    if (createdWeek) stats.wikiCreated[createdWeek] += 1
    if (createdWeek === 'current') {
      wikiCreated.push(page)
    } else if (weekOf(toJstYmd(page.updated_at)) === 'current') {
      stats.wikiUpdated.current += 1
      wikiUpdated.push(page)
    }
  }

  const heldMeetings: WeekMeeting[] = []
  for (const meeting of meetings) {
    if (!meeting.held_at) continue
    const ymd = toJstYmd(meeting.held_at)
    if (ymd > today) continue
    const week = weekOf(ymd)
    if (week) stats.meetingsHeld[week] += 1
    if (week === 'current') heldMeetings.push(meeting)
  }

  // 同じタスクを決め直した記録が何度あっても1件と数える
  const decided: Record<'current' | 'previous', Map<string, string>> = { current: new Map(), previous: new Map() }
  for (const event of decisionEvents) {
    if (event.action !== 'SPEC_DECIDE') continue
    const week = weekOf(toJstYmd(event.created_at))
    if (!week) continue
    const seen = decided[week].get(event.task_id)
    if (!seen || event.created_at > seen) decided[week].set(event.task_id, event.created_at)
  }
  stats.decisions.current = decided.current.size
  stats.decisions.previous = decided.previous.size

  return {
    weekStart,
    weekEnd,
    stats,
    days,
    lists: {
      completed: completed.sort(byNewest((t) => t.completed_at!)),
      wikiCreated: wikiCreated.sort(byNewest((p) => p.created_at)),
      wikiUpdated: wikiUpdated.sort(byNewest((p) => p.updated_at)),
      meetings: heldMeetings.sort(byNewest((m) => m.held_at!)),
      decidedTaskIds: [...decided.current.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([id]) => id),
    },
  }
}
