'use client'

import NextLink from 'next/link'
import { buildTaskHref } from '@/lib/navigation/appLinks'
import { formatTaskNumber } from '@/lib/tasks/taskNumber'
import { referencingTaskStatusLabel, type WikiReferencingTask } from '@/lib/wiki/referencingTasks'

interface WikiReferencingTasksProps {
  tasks: WikiReferencingTask[]
  loading?: boolean
  error?: boolean
}

/**
 * ページ情報パネルの「このページを参照しているタスク」。
 * 行の見た目はタスク詳細の子タスク一覧に合わせる。色は gray のトークンだけを使い、
 * `dark:` は付けない（`.dark` で gray の段が丸ごと反転するため、重ねると二重に反転して読めなくなる）。
 */
export function WikiReferencingTasks({ tasks, loading = false, error = false }: WikiReferencingTasksProps) {
  return (
    <div className="space-y-1.5" data-testid="wiki-referencing-tasks">
      <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
        このページを参照しているタスク
        {tasks.length > 0 && <span className="text-[10px] text-gray-400 ml-1">({tasks.length}件)</span>}
      </label>
      {tasks.length > 0 ? (
        <div className="space-y-1">
          {tasks.map((task) => {
            const number = formatTaskNumber(task.short_id)
            const done = task.status === 'done'
            return (
              <NextLink
                key={task.id}
                href={buildTaskHref(task.org_id, task.space_id, task.id)}
                prefetch={false}
                data-testid="wiki-referencing-task-link"
                className="group block px-2 py-1.5 bg-gray-50 hover:bg-gray-100 rounded text-sm"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  {number && <span className="flex-shrink-0 text-[10px] text-gray-400 tabular-nums">{number}</span>}
                  <span
                    className={`truncate group-hover:underline ${done ? 'text-gray-400 line-through' : 'text-gray-700'}`}
                  >
                    {task.title}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-500">
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded border border-gray-200 text-gray-600">
                    {referencingTaskStatusLabel(task.status)}
                  </span>
                  <span className="truncate">{task.assigneeName ?? '担当なし'}</span>
                </div>
              </NextLink>
            )
          })}
        </div>
      ) : loading ? (
        <p className="text-xs text-gray-400">読み込み中...</p>
      ) : error ? (
        <p className="text-xs text-gray-400">参照しているタスクを読み込めませんでした</p>
      ) : (
        <p className="text-xs text-gray-400">このページを参照しているタスクはありません</p>
      )}
    </div>
  )
}
