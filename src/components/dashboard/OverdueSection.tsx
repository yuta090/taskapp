'use client'

import { useState } from 'react'
import Link from 'next/link'
import { WarningCircle } from '@phosphor-icons/react'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import type { OverdueGroups, OverdueItem, OverdueKind } from '@/lib/dashboard/overdue'

/**
 * ダッシュボードの「期限切れ」。プロジェクト全体の期限切れを、承認待ち・クライアント確認待ち・タスクに分けて出す。
 * 分け方は src/lib/dashboard/overdue.ts。
 */

// クライアント確認待ちは相手先に見えている作業なので amber（UI ルール: amber は相手先に見える要素）
const GROUPS: ReadonlyArray<{ kind: OverdueKind; label: string; labelClass: string }> = [
  { kind: 'review', label: '承認待ち', labelClass: 'text-gray-600' },
  { kind: 'client', label: 'クライアント確認待ち', labelClass: 'text-amber-700' },
  { kind: 'task', label: 'タスク', labelClass: 'text-gray-600' },
]

/**
 * タスクの担当者の名前。担当者がいなければ null。名簿がまだ届いていないあいだは undefined を返し、
 * その間は何も出さない（一瞬「担当なし」と出てから名前に変わるのを避ける）。
 */
export type AssigneeNameOf = (task: OverdueItem['task']) => string | null | undefined

/** 見出しごとに最初に出す行数。残りは「すべて表示」で開く */
const COLLAPSED_ROWS = 5

// '2026-09-10' → '9/10'。Date を通さず文字のまま切る（タイムゾーンで1日ずれないように）
function formatMonthDay(dueDate: string): string {
  const [, m, d] = dueDate.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)}`
}

function OverdueRow({
  item,
  orgId,
  spaceId,
  assigneeNameOf,
}: {
  item: OverdueItem
  orgId: string
  spaceId: string
  assigneeNameOf: AssigneeNameOf
}) {
  const assigneeName = assigneeNameOf(item.task)
  return (
    <Link
      href={buildTaskDeepLink(orgId, spaceId, item.task.id)}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-50 transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-500" />
      <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{item.task.title}</span>
      {assigneeName !== undefined && (
        <span
          data-testid="overdue-assignee"
          className={`min-w-0 max-w-[6rem] truncate text-[11px] flex-shrink-0 ${assigneeName ? 'text-gray-600' : 'text-gray-400'}`}
          title={assigneeName ? `担当: ${assigneeName}` : undefined}
        >
          {assigneeName ?? '担当なし'}
        </span>
      )}
      {/* スマホ幅ではタスク名を読めるよう期限の日付を省き、過ぎた日数だけを出す */}
      <span className="hidden md:inline text-[11px] text-gray-400 flex-shrink-0">
        期限 {formatMonthDay(item.task.due_date!)}
      </span>
      <span className="text-[11px] text-red-600 flex-shrink-0 whitespace-nowrap text-right">
        {item.daysOverdue}日超過
      </span>
    </Link>
  )
}

function OverdueGroup({
  label,
  labelClass,
  items,
  orgId,
  spaceId,
  assigneeNameOf,
}: {
  label: string
  labelClass: string
  items: OverdueItem[]
  orgId: string
  spaceId: string
  assigneeNameOf: AssigneeNameOf
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, COLLAPSED_ROWS)
  const rest = items.length - COLLAPSED_ROWS

  return (
    <div>
      <p className={`text-[11px] font-medium mb-1.5 flex items-center gap-1.5 ${labelClass}`}>
        <span>{label}</span>
        <span className="text-gray-400 font-normal">{items.length}件</span>
      </p>
      <div className="space-y-0.5">
        {visible.map((item) => (
          <OverdueRow key={item.task.id} item={item} orgId={orgId} spaceId={spaceId} assigneeNameOf={assigneeNameOf} />
        ))}
      </div>
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 px-3 text-xs text-gray-500 hover:text-gray-700"
        >
          {expanded ? '閉じる' : `すべて表示（ほか${rest}件）`}
        </button>
      )}
    </div>
  )
}

export function OverdueSection({
  groups,
  orgId,
  spaceId,
  assigneeNameOf,
}: {
  groups: OverdueGroups
  orgId: string
  spaceId: string
  assigneeNameOf: AssigneeNameOf
}) {
  return (
    <section aria-label="期限切れ" className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-4 flex items-center gap-1.5">
        <WarningCircle className="text-base text-red-500" />
        期限切れ
        {groups.total > 0 && <span className="ml-auto text-xs text-gray-400">{groups.total}件</span>}
      </h3>
      {groups.total === 0 ? (
        <p className="text-sm text-gray-400">期限切れのものはありません</p>
      ) : (
        <div className="space-y-4">
          {GROUPS.filter((g) => groups[g.kind].length > 0).map((g) => (
            <OverdueGroup
              key={g.kind}
              label={g.label}
              labelClass={g.labelClass}
              items={groups[g.kind]}
              orgId={orgId}
              spaceId={spaceId}
              assigneeNameOf={assigneeNameOf}
            />
          ))}
        </div>
      )}
    </section>
  )
}
