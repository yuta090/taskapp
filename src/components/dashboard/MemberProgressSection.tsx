'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CaretRight, UsersThree } from '@phosphor-icons/react'
import { buildTaskDeepLink } from '@/lib/taskLinks'
import { MEMBER_BUCKETS, type MemberBucket, type MemberProgressRow } from '@/lib/dashboard/memberProgress'

/**
 * ダッシュボードの「メンバー別」。1人1行で、状態別の件数を積み上げた棒と数を出す。
 * 行を押すと、その人の残りのタスク（期限の早い順）が開く。集計は src/lib/dashboard/memberProgress.ts。
 */

// 色は状態の色の正本（taskapp-design-system）の行アイコンの色にそろえる。
// 未着手はグレーの薄い方。gray-300 はダークで境界線の色になって消えるので使わない
const BAR_CLASS: Record<MemberBucket, string> = {
  done: 'bg-green-400',
  in_review: 'bg-amber-300',
  in_progress: 'bg-blue-300',
  todo: 'bg-gray-400',
  backlog: 'bg-gray-200',
}

/** 開いたときに並べる件数。残りは件数だけ出す */
const OPEN_TASK_ROWS = 10

function formatMonthDay(dueDate: string): string {
  const [, m, d] = dueDate.slice(0, 10).split('-')
  return `${Number(m)}/${Number(d)}`
}

function MemberRow({
  row,
  name,
  today,
  orgId,
  spaceId,
}: {
  row: MemberProgressRow
  name: string
  today: string
  orgId: string
  spaceId: string
}) {
  const [open, setOpen] = useState(false)
  const total = MEMBER_BUCKETS.reduce((sum, b) => sum + row.counts[b.key], 0)
  const shown = row.openTasks.slice(0, OPEN_TASK_ROWS)
  const rest = row.openTasks.length - shown.length

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full text-left px-3 py-2 rounded-md hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <CaretRight className={`text-xs text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          <span
            className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium ${
              row.assigneeId ? 'bg-gray-200 text-gray-600' : 'bg-gray-100 text-gray-400'
            }`}
            aria-hidden="true"
          >
            {name.charAt(0)}
          </span>
          <span className={`min-w-0 truncate text-sm ${row.assigneeId ? 'text-gray-900' : 'text-gray-500'}`}>{name}</span>
          <span className="ml-auto text-[11px] text-gray-500 flex-shrink-0">残り {row.open}件</span>
          {row.overdue > 0 && (
            <span className="text-[11px] text-red-600 flex-shrink-0">期限切れ {row.overdue}</span>
          )}
        </div>
        {/* 積み上げ棒。区切りは 2px のすき間。数は下の文字で読めるので、棒は飾り扱い */}
        <div className="flex h-2 gap-[2px] pl-5" aria-hidden="true">
          {MEMBER_BUCKETS.filter((b) => row.counts[b.key] > 0).map((b) => (
            <span
              key={b.key}
              className={`${BAR_CLASS[b.key]} rounded-sm first:rounded-l last:rounded-r`}
              style={{ width: `${(row.counts[b.key] / total) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 pl-5 text-[11px] text-gray-500">
          {MEMBER_BUCKETS.filter((b) => row.counts[b.key] > 0).map((b) => (
            <span key={b.key} className="whitespace-nowrap">
              {b.label} {row.counts[b.key]}
            </span>
          ))}
        </div>
      </button>

      {open && (
        <div className="pl-10 pr-3 pb-2">
          {row.openTasks.length === 0 ? (
            <p className="text-xs text-gray-400 py-1">残りのタスクはありません</p>
          ) : (
            <ul className="space-y-0.5">
              {shown.map((task) => {
                const late = task.due_date != null && task.due_date.slice(0, 10) < today
                return (
                  <li key={task.id}>
                    <Link
                      href={buildTaskDeepLink(orgId, spaceId, task.id)}
                      className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-gray-50 transition-colors"
                    >
                      <span className="flex-1 min-w-0 truncate text-sm text-gray-700">{task.title}</span>
                      {task.due_date && (
                        <span className={`text-[11px] flex-shrink-0 ${late ? 'text-red-600' : 'text-gray-400'}`}>
                          期限 {formatMonthDay(task.due_date)}
                        </span>
                      )}
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          {rest > 0 && <p className="px-2 pt-1 text-[11px] text-gray-400">ほか{rest}件</p>}
        </div>
      )}
    </li>
  )
}

export function MemberProgressSection({
  rows,
  nameOf,
  today,
  orgId,
  spaceId,
}: {
  rows: MemberProgressRow[]
  /** 担当者の表示名。null は担当者のいないタスクの行 */
  nameOf: (assigneeId: string | null) => string
  today: string
  orgId: string
  spaceId: string
}) {
  return (
    <section aria-label="メンバー別の進み具合" className="bg-surface border border-gray-200 rounded-lg p-6">
      <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-1.5">
        <UsersThree className="text-base text-gray-500" />
        メンバー別の進み具合
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400">タスクがありません</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-3 text-[11px] text-gray-500" aria-hidden="true">
            {MEMBER_BUCKETS.map((b) => (
              <span key={b.key} className="inline-flex items-center gap-1">
                <span className={`w-2 h-2 rounded-sm ${BAR_CLASS[b.key]}`} />
                {b.label}
              </span>
            ))}
          </div>
          <ul className="space-y-1">
            {rows.map((row) => (
              <MemberRow
                key={row.assigneeId ?? 'unassigned'}
                row={row}
                name={nameOf(row.assigneeId)}
                today={today}
                orgId={orgId}
                spaceId={spaceId}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
