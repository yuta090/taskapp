/**
 * プロジェクトのダッシュボードに出す数字と一覧（純粋関数）。読むだけ。
 *
 * 数え方は Web のダッシュボード（DashboardClient）と同じ共有関数を使う（画面ごとに数え方が
 * ずれると、同じプロジェクトの数字が Web とアプリで食い違う）:
 * 絞り込み = src/lib/tasks/quickFilters.ts、期限切れ = src/lib/dashboard/overdue.ts、
 * クライアント確認・期限が近いタスク = src/lib/dashboard/followUps.ts、マイルストーン = src/lib/dashboard/milestoneProgress.ts。
 */
import { classifyFollowUps, upcomingDeadlines, type ClientFollowUp, type UpcomingDeadline } from '@/lib/dashboard/followUps'
import { milestoneProgress, type MilestoneProgressItem } from '@/lib/dashboard/milestoneProgress'
import { groupOverdueTasks, type OverdueGroups } from '@/lib/dashboard/overdue'
import { applyQuickFilter } from '@/lib/tasks/quickFilters'
import type { Meeting, Milestone, ReviewStatus, Task } from '@/types/database'

/** 「直近の予定」に出す最大件数（Web の UpcomingMeetingsSection と同じ） */
export const UPCOMING_MEETING_LIMIT = 5

export interface DashboardInput {
  tasks: Task[]
  /** タスクごとの最新の承認依頼の状態（fetchTasksQuery が一緒に返す） */
  reviewStatuses: Record<string, ReviewStatus>
  meetings: Meeting[]
  milestones: Milestone[]
  /** 日本時間の今日（'YYYY-MM-DD'） */
  today: string
  /** 今の時刻（待ち日数と、これからの会議の判定に使う） */
  now: Date
}

export interface DashboardData {
  kpi: { active: number; backlog: number; inReview: number; clientWait: number }
  overdueGroups: OverdueGroups
  followUps: ClientFollowUp[]
  upcomingDeadlines: UpcomingDeadline[]
  upcomingMeetings: Meeting[]
  milestones: MilestoneProgressItem[]
}

export function buildDashboard({ tasks, reviewStatuses, meetings, milestones, today, now }: DashboardInput): DashboardData {
  // buildProjectTaskList と同じく、返事待ち（open）の承認依頼があるタスク
  const openReviewTaskIds = new Set(
    Object.entries(reviewStatuses)
      .filter(([, status]) => status === 'open')
      .map(([taskId]) => taskId)
  )
  const ctx = { today, openReviewTaskIds }

  const upcomingMeetings = meetings
    .filter((m) => m.status === 'planned' && m.held_at && new Date(m.held_at) >= now)
    .sort((a, b) => new Date(a.held_at!).getTime() - new Date(b.held_at!).getTime())
    .slice(0, UPCOMING_MEETING_LIMIT)

  return {
    kpi: {
      active: applyQuickFilter(tasks, 'active', ctx).length,
      backlog: applyQuickFilter(tasks, 'backlog', ctx).length,
      inReview: applyQuickFilter(tasks, 'in_review', ctx).length,
      clientWait: applyQuickFilter(tasks, 'client_wait', ctx).length,
    },
    overdueGroups: groupOverdueTasks(tasks, today, openReviewTaskIds),
    followUps: classifyFollowUps(tasks, today, now),
    upcomingDeadlines: upcomingDeadlines(tasks, today),
    upcomingMeetings,
    milestones: milestoneProgress(milestones, tasks, today),
  }
}
