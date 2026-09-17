'use client'

import { useState } from 'react'
import Link from 'next/link'
import { SealCheck } from '@phosphor-icons/react'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import type { Task } from '@/types/database'
import { formatDecidedDate, type DecidedItem, type DecisionSummary } from '@/lib/dashboard/decisions'

/**
 * ダッシュボードの「確定事項」。このプロジェクトで決まったことを新しい順に出し、まだ決まっていないもの
 * （検討中）を下に添える。押すとその決定事項のタスクが開く。中身の作り方は src/lib/dashboard/decisions.ts。
 *
 * 決まった日は記録（task_events）から後追いで届く。届くまでは日付だけが出ないので、一覧そのものは
 * 待たずに出す（タスクは画面に来た時点でそろっている）。
 */

/** 見出しごとに最初に出す行数。残りは「すべて表示」で開く */
const COLLAPSED_ROWS = 5

/** 文字色は *-ink を使う。green-700/blue-700 はダークで反転せず、暗くなった面の上で読めない */
function StateBadge({ state }: { state: Task['decision_state'] }) {
  const implemented = state === 'implemented'
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
        implemented ? 'bg-green-50 text-green-ink' : 'bg-blue-50 text-blue-ink'
      }`}
    >
      {implemented ? '実装済み' : '決定済み'}
    </span>
  )
}

function DecidedRow({
  item,
  currentYear,
  orgId,
  spaceId,
}: {
  item: DecidedItem
  currentYear: number
  orgId: string
  spaceId: string
}) {
  return (
    <Link
      href={buildTaskDeepLink(orgId, spaceId, item.task.id)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
    >
      <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{item.task.title}</span>
      <StateBadge state={item.task.decision_state} />
      {item.decidedAt && (
        <time dateTime={item.decidedAt} className="text-[11px] text-gray-400 flex-shrink-0 whitespace-nowrap">
          {formatDecidedDate(item.decidedAt, currentYear)}
        </time>
      )}
    </Link>
  )
}

function ConsideringRow({ task, orgId, spaceId }: { task: Task; orgId: string; spaceId: string }) {
  return (
    <Link
      href={buildTaskDeepLink(orgId, spaceId, task.id)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-gray-300" />
      <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{task.title}</span>
    </Link>
  )
}

function Group({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium mb-1.5 flex items-center gap-1.5 text-gray-600">
        <span>{label}</span>
        <span className="text-gray-400 font-normal">{count}件</span>
      </p>
      {children}
    </div>
  )
}

function ExpandButton({ rest, expanded, onClick }: { rest: number; expanded: boolean; onClick: () => void }) {
  if (rest <= 0) return null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={expanded}
      className="mt-1 px-3 text-xs text-gray-500 hover:text-gray-700"
    >
      {expanded ? '閉じる' : `すべて表示（ほか${rest}件）`}
    </button>
  )
}

export function DecisionsSection({
  summary,
  currentYear,
  orgId,
  spaceId,
}: {
  summary: DecisionSummary
  /** 日本時間の今年。同じ年の確定は月日だけで出す */
  currentYear: number
  orgId: string
  spaceId: string
}) {
  const [decidedExpanded, setDecidedExpanded] = useState(false)
  const [consideringExpanded, setConsideringExpanded] = useState(false)

  const decidedVisible = decidedExpanded ? summary.decided : summary.decided.slice(0, COLLAPSED_ROWS)
  const consideringVisible = consideringExpanded
    ? summary.considering
    : summary.considering.slice(0, COLLAPSED_ROWS)

  return (
    <section aria-label="確定事項" className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <SealCheck className="text-base text-gray-500" />
        確定事項
        {summary.decided.length > 0 && (
          <span className="ml-auto text-xs text-gray-400">{summary.decided.length}件</span>
        )}
      </h3>

      {summary.decided.length === 0 && summary.considering.length === 0 ? (
        <p className="text-sm text-gray-400">まだ決まったことはありません</p>
      ) : (
        <div className="space-y-4">
          {summary.decided.length > 0 && (
            <Group label="決まったこと" count={summary.decided.length}>
              <div className="space-y-0.5">
                {decidedVisible.map((item) => (
                  <DecidedRow
                    key={item.task.id}
                    item={item}
                    currentYear={currentYear}
                    orgId={orgId}
                    spaceId={spaceId}
                  />
                ))}
              </div>
              <ExpandButton
                rest={summary.decided.length - COLLAPSED_ROWS}
                expanded={decidedExpanded}
                onClick={() => setDecidedExpanded((v) => !v)}
              />
            </Group>
          )}

          {summary.considering.length > 0 && (
            <Group label="検討中" count={summary.considering.length}>
              <div className="space-y-0.5">
                {consideringVisible.map((task) => (
                  <ConsideringRow key={task.id} task={task} orgId={orgId} spaceId={spaceId} />
                ))}
              </div>
              <ExpandButton
                rest={summary.considering.length - COLLAPSED_ROWS}
                expanded={consideringExpanded}
                onClick={() => setConsideringExpanded((v) => !v)}
              />
            </Group>
          )}
        </div>
      )}
    </section>
  )
}
