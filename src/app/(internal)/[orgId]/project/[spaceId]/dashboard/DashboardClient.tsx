'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import {
  Warning,
  Clock,
  Users,
  CalendarBlank,
  Eye,
} from '@phosphor-icons/react'
import { Breadcrumb, LoadingState, ErrorRetry } from '@/components/shared'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { getClientWaitingDays } from '@/lib/tasks/clientWaitingDays'
import { useTasks } from '@/lib/hooks/useTasks'
import { useMilestones } from '@/lib/hooks/useMilestones'
import { useMeetings } from '@/lib/hooks/useMeetings'
import { useRiskForecast } from '@/lib/hooks/useRiskForecast'
import type { Task, Milestone } from '@/types/database'
import type { RiskLevel } from '@/lib/risk/calculateRisk'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { buildMeetingHref } from '@/lib/navigation/meetingLinks'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useRecentTaskComments } from '@/lib/hooks/useRecentTaskComments'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import { daysOverdue, groupOverdueTasks } from '@/lib/dashboard/overdue'
import { UNKNOWN_PROFILE_LABEL } from '@/lib/labels'
import { latestCommentPerTask, RECENT_COMMENT_TASK_LIMIT } from '@/lib/dashboard/recentComments'
import { DASHBOARD_WIDGETS, useDashboardWidgetPrefs, type DashboardWidgetId } from '@/lib/dashboard/widgetPrefs'
import { OverdueSection } from '@/components/dashboard/OverdueSection'
import { RecentCommentsSection, type RecentCommentItem } from '@/components/dashboard/RecentCommentsSection'
import { DashboardWidgetMenu } from '@/components/dashboard/DashboardWidgetMenu'

// -- Constants --

/** Days since ball was passed to client before showing warning */
const FOLLOW_UP_WARN_DAYS = 5
const FOLLOW_UP_URGENT_DAYS = 7

interface DashboardClientProps {
  orgId: string
  spaceId: string
}

// -- Helpers --

/**
 * 期限まであと何日か（過ぎていれば負）。日本時間の今日の文字列と期限の日付だけで数える。
 * 「期限切れ」（src/lib/dashboard/overdue.ts）と同じ数え方にして、同じ画面で食い違わないようにする
 * （前は new Date(due_date) と今の時刻の差だったので、朝9時を過ぎると今日が期限のタスクが「1日超過」になった）。
 */
function daysUntil(dueDate: string, today: string): number {
  return -daysOverdue(dueDate, today)
}

type FollowUpLevel = 'urgent' | 'warn'

interface ClientFollowUp {
  task: Task
  level: FollowUpLevel
  /** Days since task.updated_at (proxy for ball pass date) */
  staleDays: number
  /** Days until due (negative = overdue) */
  dueDaysLeft: number | null
}

function classifyFollowUps(tasks: Task[], today: string): ClientFollowUp[] {
  const now = new Date()
  const clientTasks = tasks.filter(
    (t) => t.ball === 'client' && t.status !== 'done'
  )

  const items: ClientFollowUp[] = []

  for (const task of clientTasks) {
    // Shared with TaskRow's "N日待ち" badge (B-4) so the two views can't disagree.
    const staleDays = getClientWaitingDays(task.updated_at, now)
    const dueDaysLeft = task.due_date ? daysUntil(task.due_date, today) : null

    // urgent: overdue OR stale 7+ days with due soon
    const isOverdue = dueDaysLeft !== null && dueDaysLeft < 0
    const isStaleUrgent =
      staleDays >= FOLLOW_UP_URGENT_DAYS && dueDaysLeft !== null && dueDaysLeft <= 3

    if (isOverdue || isStaleUrgent) {
      items.push({ task, level: 'urgent', staleDays, dueDaysLeft })
      continue
    }

    // warn: stale 5+ days OR due within a week
    const isStaleWarn = staleDays >= FOLLOW_UP_WARN_DAYS
    const isDueSoon = dueDaysLeft !== null && dueDaysLeft <= 7

    if (isStaleWarn || isDueSoon) {
      items.push({ task, level: 'warn', staleDays, dueDaysLeft })
    }
  }

  // Sort: urgent first, then by staleDays descending
  items.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'urgent' ? -1 : 1
    return b.staleDays - a.staleDays
  })

  return items
}

function formatDueDays(days: number | null): string {
  if (days === null) return '期限なし'
  if (days < 0) return `${Math.abs(days)}日超過`
  if (days === 0) return '今日'
  return `${days}日後`
}

function riskBadge(level: RiskLevel) {
  const styles: Record<RiskLevel, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-green-100 text-green-700',
    none: 'bg-gray-100 text-gray-500',
    unknown: 'bg-gray-100 text-gray-500',
  }
  const labels: Record<RiskLevel, string> = {
    high: '高リスク',
    medium: '中リスク',
    low: '低リスク',
    none: '完了',
    unknown: 'データ待ち',
  }
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${styles[level]}`}
    >
      {labels[level]}
    </span>
  )
}

// -- Sub-components --

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: number | string
  sub?: string
  accent?: 'red' | 'amber' | 'green'
}) {
  const accentColor =
    accent === 'red'
      ? 'text-red-600'
      : accent === 'amber'
        ? 'text-amber-600'
        : accent === 'green'
          ? 'text-green-600'
          : 'text-gray-900'

  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-4 min-w-0">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${accentColor}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function ClientFollowUpSection({
  items,
  orgId,
  spaceId,
}: {
  items: ClientFollowUp[]
  orgId: string
  spaceId: string
}) {
  const urgent = items.filter((i) => i.level === 'urgent')
  const warn = items.filter((i) => i.level === 'warn')

  if (items.length === 0) {
    return (
      <div className="bg-surface border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-1.5">
          <Eye className="text-base text-gray-500" />
          クライアント確認が必要
        </h3>
        <p className="text-sm text-gray-400">現在フォローが必要なタスクはありません</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <Eye className="text-base text-gray-500" />
        クライアント確認が必要
        <span className="ml-auto text-xs text-gray-400">{items.length}件</span>
      </h3>

      {urgent.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-medium text-red-600 mb-1.5 flex items-center gap-1">
            <Warning weight="fill" className="text-xs" />
            要フォロー
          </p>
          <div className="space-y-1">
            {urgent.map((item) => (
              <FollowUpRow
                key={item.task.id}
                item={item}
                orgId={orgId}
                spaceId={spaceId}
              />
            ))}
          </div>
        </div>
      )}

      {warn.length > 0 && (
        <div>
          <p className="text-[11px] font-medium text-amber-600 mb-1.5 flex items-center gap-1">
            <Clock className="text-xs" />
            そろそろ確認
          </p>
          <div className="space-y-1">
            {warn.map((item) => (
              <FollowUpRow
                key={item.task.id}
                item={item}
                orgId={orgId}
                spaceId={spaceId}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FollowUpRow({
  item,
  orgId,
  spaceId,
}: {
  item: ClientFollowUp
  orgId: string
  spaceId: string
}) {
  const isUrgent = item.level === 'urgent'
  return (
    <Link
      href={buildTaskDeepLink(orgId, spaceId, item.task.id)}
      className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
        isUrgent
          ? 'bg-red-50 hover:bg-red-100'
          : 'bg-amber-50 hover:bg-amber-100'
      }`}
    >
      <span className="flex-1 min-w-0 truncate text-gray-800">
        {item.task.title}
      </span>
      <span
        className={`text-[11px] flex-shrink-0 ${
          isUrgent ? 'text-red-600' : 'text-amber-600'
        }`}
      >
        {formatDueDays(item.dueDaysLeft)}
      </span>
      <span className="text-[11px] text-gray-400 flex-shrink-0 w-16 text-right">
        渡して{item.staleDays}日
      </span>
    </Link>
  )
}

export function MilestoneProgressSection({
  milestones,
  tasks,
  forecasts,
  today = formatDateToLocalString(jstNow()),
}: {
  milestones: Milestone[]
  tasks: Task[]
  forecasts: Map<string, { level: RiskLevel }>
  /** 日本時間の今日（'YYYY-MM-DD'）。省略したらその場で作る */
  today?: string
}) {
  const activeMilestones = milestones.filter((m) => !m.completed_at)

  if (activeMilestones.length === 0) {
    return (
      <div className="bg-surface border border-gray-200 rounded-lg p-6">
        <h3 className="text-sm font-medium text-gray-900 mb-3">マイルストーン進捗</h3>
        <p className="text-sm text-gray-400">マイルストーンがありません</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">マイルストーン進捗</h3>
      <div className="space-y-3">
        {activeMilestones.map((ms) => {
          const msTasks = tasks.filter((t) => t.milestone_id === ms.id)
          const done = msTasks.filter((t) => t.status === 'done').length
          const total = msTasks.length
          const pct = total > 0 ? Math.round((done / total) * 100) : 0
          const forecast = forecasts.get(ms.id)
          const dueStr = ms.due_date
            ? formatDueDays(daysUntil(ms.due_date, today))
            : null

          return (
            <div key={ms.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-700 font-medium truncate">
                  {ms.name}
                </span>
                <div className="flex items-center gap-2">
                  {dueStr && (
                    <span className="text-[10px] text-gray-400">{dueStr}</span>
                  )}
                  {total === 0 ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                      タスクなし
                    </span>
                  ) : (
                    forecast && riskBadge(forecast.level)
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-[11px] text-gray-500 w-12 text-right">
                  {done}/{total}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BallDistributionSection({ tasks }: { tasks: Task[] }) {
  const active = tasks.filter((t) => t.status !== 'done')
  const internal = active.filter((t) => t.ball === 'internal').length
  const client = active.filter((t) => t.ball === 'client').length
  const total = internal + client

  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4">ボール所在</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-400">アクティブなタスクなし</p>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-600">社内</span>
              <span className="text-xs text-gray-500">{internal}件</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all"
                style={{ width: `${total > 0 ? (internal / total) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-amber-700">クライアント</span>
              <span className="text-xs text-gray-500">{client}件</span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 rounded-full transition-all"
                style={{ width: `${total > 0 ? (client / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function UpcomingDeadlinesSection({
  tasks,
  orgId,
  spaceId,
  today,
}: {
  tasks: Task[]
  orgId: string
  spaceId: string
  today: string
}) {
  const upcoming = tasks
    .filter((t) => t.status !== 'done' && t.due_date)
    .map((t) => ({
      task: t,
      daysLeft: daysUntil(t.due_date!, today),
    }))
    .filter((t) => t.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, 8)

  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <CalendarBlank className="text-base text-gray-500" />
        期限が近いタスク
      </h3>
      {upcoming.length === 0 ? (
        <p className="text-sm text-gray-400">直近1週間に期限のタスクなし</p>
      ) : (
        <div className="space-y-1">
          {upcoming.map(({ task, daysLeft }) => {
            const color =
              daysLeft < 0
                ? 'text-red-600'
                : daysLeft <= 2
                  ? 'text-amber-600'
                  : 'text-green-600'
            const dot =
              daysLeft < 0
                ? 'bg-red-500'
                : daysLeft <= 2
                  ? 'bg-amber-500'
                  : 'bg-green-500'
            return (
              <Link
                key={task.id}
                href={buildTaskDeepLink(orgId, spaceId, task.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                <span className="flex-1 min-w-0 truncate text-sm text-gray-700">
                  {task.title}
                </span>
                <span className={`text-[11px] flex-shrink-0 ${color}`}>
                  {formatDueDays(daysLeft)}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function UpcomingMeetingsSection({
  orgId,
  spaceId,
  meetings,
}: {
  orgId: string
  spaceId: string
  meetings: Array<{ id: string; title: string; held_at: string | null; status: string }>
}) {
  const now = new Date()
  const upcoming = meetings
    .filter((m) => m.status === 'planned' && m.held_at && new Date(m.held_at) >= now)
    .sort((a, b) => new Date(a.held_at!).getTime() - new Date(b.held_at!).getTime())
    .slice(0, 5)

  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <Users className="text-base text-gray-500" />
        直近の予定
      </h3>
      {upcoming.length === 0 ? (
        <p className="text-sm text-gray-400">予定されたミーティングなし</p>
      ) : (
        <div className="space-y-1">
          {upcoming.map((m) => {
            const d = new Date(m.held_at!)
            const dateStr = `${d.getMonth() + 1}/${d.getDate()}`
            const timeStr = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
            return (
              <Link
                key={m.id}
                href={buildMeetingHref(`/${orgId}/project/${spaceId}`, m.id)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
              >
                <span className="text-xs text-gray-500 flex-shrink-0 w-16">
                  {dateStr} {timeStr}
                </span>
                <span className="flex-1 min-w-0 truncate text-sm text-gray-700">
                  {m.title}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// -- Main --

/** 2列の格子に並べる小さい項目 */
const HALF_WIDTH_WIDGETS: readonly DashboardWidgetId[] = ['milestones', 'ball', 'upcoming_deadlines', 'meetings']

export function DashboardClient({ orgId, spaceId }: DashboardClientProps) {
  const widgets = useDashboardWidgetPrefs()
  const { isVisible } = widgets
  const showRecentComments = isVisible('recent_comments')

  const { tasks, reviewStatuses, loading: tasksLoading, error: tasksError, fetchTasks } = useTasks({ orgId, spaceId })
  const { milestones, loading: msLoading } = useMilestones({ spaceId })
  const { meetings } = useMeetings({ orgId, spaceId })
  const { forecasts } = useRiskForecast({ tasks, milestones })
  // 「最近のコメント」を隠しているあいだは、コメントも書いた人の名前も読みに行かない
  const {
    comments: recentCommentRows,
    loading: commentsLoading,
    error: commentsError,
  } = useRecentTaskComments(spaceId, { enabled: showRecentComments })
  const { members, isPending: membersPending } = useSpaceMembers(showRecentComments ? spaceId : null)

  const loading = tasksLoading || msLoading

  // 日本時間の今日。期限の判定はすべてこれと期限の日付を比べる（new Date(due_date) と今の時刻を比べると、
  // 期限が今日のタスクが朝9時に「超過」になる）
  const today = formatDateToLocalString(jstNow())

  const followUps = useMemo(() => classifyFollowUps(tasks, today), [tasks, today])

  // KPI calculations
  const activeTasks = useMemo(
    () => tasks.filter((t) => t.status !== 'done'),
    [tasks]
  )
  // 返事待ちの承認依頼があるタスク。タスク一覧と一緒に読む「タスクごとの最新の依頼の状態」を使う
  // （承認依頼の一覧 useReviews は新しい50件しか読まないので、古い依頼が漏れる）
  const openReviewTaskIds = useMemo(
    () => new Set(Object.keys(reviewStatuses).filter((taskId) => reviewStatuses[taskId] === 'open')),
    [reviewStatuses]
  )
  // 上の「期限超過」と下の「期限切れ」は同じ数え方にする（件数が食い違わないように）
  const overdueGroups = useMemo(
    () => groupOverdueTasks(tasks, today, openReviewTaskIds),
    [tasks, today, openReviewTaskIds]
  )

  // タスク名はタスク一覧（全件）から引く。一覧に無いタスク（消したタスクなど）のコメントは出さない
  const recentCommentItems = useMemo<RecentCommentItem[]>(() => {
    const titleById = new Map(tasks.map((t) => [t.id, t.title]))
    const nameById = new Map(members.map((m) => [m.id, m.displayName]))
    return latestCommentPerTask(
      recentCommentRows.filter((c) => titleById.has(c.task_id)),
      RECENT_COMMENT_TASK_LIMIT
    ).map((comment) => ({
      comment,
      taskTitle: titleById.get(comment.task_id)!,
      // 名簿にいない人（プロジェクトから外れた人など）は、タスクのコメント欄と同じ言葉で出す
      authorName: nameById.get(comment.actor_id) || UNKNOWN_PROFILE_LABEL,
    }))
  }, [tasks, recentCommentRows, members])

  const basePath = `/${orgId}/project/${spaceId}`
  const showHalfGrid = HALF_WIDTH_WIDGETS.some(isVisible)
  const nothingVisible = DASHBOARD_WIDGETS.every((w) => !isVisible(w.id))

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      {/* Header */}
      <div className="px-6 pt-4 pb-2 flex items-center gap-2">
        <Breadcrumb
          items={[
            { label: 'プロジェクト', href: basePath },
            { label: 'ダッシュボード' },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <DashboardWidgetMenu {...widgets} />
          {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
              AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
              モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
          <div data-header-bell className="hidden md:block -my-1.5">
            <AnnouncementBell />
          </div>
        </div>
      </div>

      {/* ヘッダーは上で必ず描いてから、本文だけを差し替える */}
      {loading ? (
        <LoadingState />
      ) : tasksError ? (
        <ErrorRetry message="データの読み込みに失敗しました" onRetry={fetchTasks} />
      ) : (
      <div className="px-6 pb-8 space-y-6 max-w-5xl">
        {nothingVisible && (
          <p className="py-12 text-center text-sm text-gray-500">
            表示する項目がありません。右上の「表示する項目」から選んでください。
          </p>
        )}

        {/* KPI Cards */}
        {isVisible('kpi') && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              label="残タスク"
              value={activeTasks.length}
              sub={`完了 ${tasks.length - activeTasks.length}`}
            />
            <KpiCard
              label="ボール (社内/クライアント)"
              value={`${activeTasks.filter((t) => t.ball === 'internal').length} / ${activeTasks.filter((t) => t.ball === 'client').length}`}
            />
            <KpiCard
              label="期限超過"
              value={overdueGroups.total}
              accent={overdueGroups.total > 0 ? 'red' : undefined}
            />
            <KpiCard
              label="レビュー待ち"
              value={openReviewTaskIds.size}
              accent={openReviewTaskIds.size > 0 ? 'amber' : undefined}
            />
          </div>
        )}

        {isVisible('overdue') && (
          <OverdueSection groups={overdueGroups} orgId={orgId} spaceId={spaceId} />
        )}

        {isVisible('recent_comments') && (
          <RecentCommentsSection
            items={recentCommentItems}
            // 名簿がまだ届いていないあいだに出すと、書いた人の欄が一瞬「（メンバー外）」になる
            loading={commentsLoading || membersPending}
            failed={commentsError != null}
            orgId={orgId}
            spaceId={spaceId}
          />
        )}

        {/* Client Follow-up */}
        {isVisible('client_follow_up') && (
          <ClientFollowUpSection
            items={followUps}
            orgId={orgId}
            spaceId={spaceId}
          />
        )}

        {/* 2-column grid。隠した項目のぶんは詰めて並べる */}
        {showHalfGrid && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {isVisible('milestones') && (
              <MilestoneProgressSection
                milestones={milestones}
                tasks={tasks}
                forecasts={forecasts}
                today={today}
              />
            )}
            {isVisible('ball') && <BallDistributionSection tasks={tasks} />}
            {isVisible('upcoming_deadlines') && (
              <UpcomingDeadlinesSection
                tasks={tasks}
                orgId={orgId}
                spaceId={spaceId}
                today={today}
              />
            )}
            {isVisible('meetings') && (
              <UpcomingMeetingsSection
                orgId={orgId}
                spaceId={spaceId}
                meetings={meetings}
              />
            )}
          </div>
        )}
      </div>
      )}
    </div>
  )
}
