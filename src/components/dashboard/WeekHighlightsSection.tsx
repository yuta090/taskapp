'use client'

import Link from 'next/link'
import { Sparkle } from '@phosphor-icons/react'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { buildWikiPageHref, buildMinutesHref } from '@/lib/navigation/appLinks'
import { toJstYmd, type WeekCount, type WeekSummary } from '@/lib/dashboard/weekHighlights'
import type { Task } from '@/types/database'

/**
 * ダッシュボードの「今週」。今週（月〜日）の動きを、数のタイル・日ごとの棒・一覧で出す。
 * 集計は src/lib/dashboard/weekHighlights.ts。
 */

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// '2026-09-14' → '9/14(月)'。Date は曜日を出すためだけに年月日の成分から作る（タイムゾーンに左右されない）
function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`
}

/** 1つの一覧に並べる件数 */
const LIST_ROWS = 6

function diffText(count: WeekCount): string {
  const diff = count.current - count.previous
  if (diff === 0) return '先週と同じ'
  return diff > 0 ? `先週より +${diff}` : `先週より ${diff}`
}

function StatTile({
  label,
  count,
  loading = false,
}: {
  label: string
  count: WeekCount | { current: number }
  /** まだ数が届いていない（0 と出すと「動きが無かった」と読めてしまう） */
  loading?: boolean
}) {
  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-3 min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-1">
        <span className="text-2xl font-semibold text-gray-900">{loading ? '…' : count.current}</span>
        {'previous' in count && !loading ? (
          <span className="block text-[11px] text-gray-400 mt-0.5">
            先週 {count.previous}・{diffText(count)}
          </span>
        ) : (
          <span className="block text-[11px] text-gray-400 mt-0.5">&nbsp;</span>
        )}
      </dd>
    </div>
  )
}

// 完了は「完了」の状態の色（green）、新規はアプリの基調の色（indigo）
const SERIES = [
  { key: 'completed', label: '完了', barClass: 'bg-green-400' },
  { key: 'created', label: '新規', barClass: 'bg-indigo-400' },
] as const

const CHART_HEIGHT_PX = 96

function DailyChart({ days, today }: { days: WeekSummary['days']; today: string }) {
  const max = Math.max(1, ...days.flatMap((d) => [d.completed, d.created]))
  return (
    <div className="bg-surface border border-gray-200 rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <p className="text-xs font-medium text-gray-700">日ごとのタスク</p>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-gray-500">
          {SERIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className={`w-2 h-2 rounded-sm ${s.barClass}`} aria-hidden="true" />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div role="img" aria-label="日ごとの完了と新規のタスク数" className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const label = `${formatDay(day.date)} 完了 ${day.completed}件・新規 ${day.created}件`
          const future = day.date > today
          return (
            <div key={day.date} aria-label={label} title={label} className="flex flex-col items-center min-w-0 group">
              <div
                className="w-full flex items-end justify-center gap-[2px] border-b border-gray-200 group-hover:bg-gray-50 rounded-t"
                style={{ height: CHART_HEIGHT_PX }}
              >
                {SERIES.map((s) => {
                  const value = day[s.key]
                  return (
                    <span
                      key={s.key}
                      className={`w-2.5 rounded-t ${s.barClass}`}
                      // 0件でも棒の位置が分かるよう、高さ0にして場所だけ取る
                      style={{ height: value === 0 ? 0 : Math.max(4, (value / max) * CHART_HEIGHT_PX) }}
                    />
                  )
                })}
              </div>
              <span
                className={`mt-1 text-[10px] whitespace-nowrap ${
                  day.date === today ? 'text-gray-900 font-medium' : future ? 'text-gray-400' : 'text-gray-500'
                }`}
              >
                {formatDay(day.date)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HighlightList({
  title,
  items,
}: {
  title: string
  items: Array<{ id: string; label: string; href: string; meta?: string }>
}) {
  if (items.length === 0) return null
  const shown = items.slice(0, LIST_ROWS)
  const rest = items.length - shown.length
  return (
    <div>
      <p className="text-[11px] font-medium text-gray-600 mb-1.5 flex items-center gap-1.5">
        <span>{title}</span>
        <span className="text-gray-400 font-normal">{items.length}件</span>
      </p>
      <ul className="space-y-0.5">
        {shown.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
            >
              <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{item.label}</span>
              {item.meta && <span className="text-[11px] text-gray-400 flex-shrink-0">{item.meta}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {rest > 0 && <p className="px-3 pt-1 text-[11px] text-gray-400">ほか{rest}件</p>}
    </div>
  )
}

export function WeekHighlightsSection({
  summary,
  tasks,
  today,
  loading,
  decisionsLoading,
  orgId,
  spaceId,
}: {
  summary: WeekSummary
  /** 決まったことのタスク名を引く */
  tasks: readonly Task[]
  today: string
  /** Wiki の動きを読み込み中 */
  loading: boolean
  /** 決めたときの記録を読み込み中 */
  decisionsLoading: boolean
  orgId: string
  spaceId: string
}) {
  const { stats, lists } = summary
  const titleById = new Map(tasks.map((t) => [t.id, t.title]))

  const lanes = [
    {
      title: '完了したタスク',
      items: lists.completed.map((t) => ({ id: t.id, label: t.title, href: buildTaskDeepLink(orgId, spaceId, t.id) })),
    },
    {
      title: '決まったこと',
      items: lists.decidedTaskIds
        .filter((id) => titleById.has(id))
        .map((id) => ({ id, label: titleById.get(id)!, href: buildTaskDeepLink(orgId, spaceId, id) })),
    },
    {
      title: '新しい Wiki',
      items: lists.wikiCreated.map((p) => ({ id: p.id, label: p.title || '無題', href: buildWikiPageHref(orgId, spaceId, p.id) })),
    },
    {
      title: '更新した Wiki',
      items: lists.wikiUpdated.map((p) => ({ id: p.id, label: p.title || '無題', href: buildWikiPageHref(orgId, spaceId, p.id) })),
    },
    {
      title: '開いた会議',
      items: lists.meetings.map((m) => ({
        id: m.id,
        label: m.title,
        href: buildMinutesHref(orgId, spaceId, m.id),
        meta: m.held_at ? formatDay(toJstYmd(m.held_at)) : undefined,
      })),
    },
  ]
  const nothing = lanes.every((l) => l.items.length === 0)

  return (
    <section aria-label="今週のハイライト" className="space-y-4">
      <h3 className="text-sm font-medium text-gray-900 flex items-center gap-1.5">
        <Sparkle className="text-base text-gray-500" />
        今週のハイライト
        <span className="text-xs text-gray-400 font-normal">
          {formatDay(summary.weekStart)}〜{formatDay(summary.weekEnd)}
        </span>
      </h3>

      <dl className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label="完了したタスク" count={stats.completedTasks} />
        <StatTile label="新しいタスク" count={stats.createdTasks} />
        <StatTile label="決まったこと" count={stats.decisions} loading={decisionsLoading} />
        <StatTile label="新しい Wiki" count={stats.wikiCreated} loading={loading} />
        <StatTile label="更新した Wiki" count={stats.wikiUpdated} loading={loading} />
        <StatTile label="開いた会議" count={stats.meetingsHeld} />
      </dl>

      <DailyChart days={summary.days} today={today} />

      <div className="bg-surface border border-gray-200 rounded-lg p-6">
        {nothing ? (
          <p className="text-sm text-gray-400">{loading || decisionsLoading ? '読み込み中…' : '今週の動きはまだありません'}</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-5">
            {lanes.map((lane) => (
              <HighlightList key={lane.title} title={lane.title} items={lane.items} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
