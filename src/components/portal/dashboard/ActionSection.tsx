'use client'

import { CheckCircle } from '@phosphor-icons/react'
import { ActionCard } from '../ui'

interface Task {
  id: string
  title: string
  dueDate?: string | null
  isOverdue?: boolean
  waitingDays?: number
  type?: 'task' | 'spec'
  estimatedCost?: number | null
  estimateStatus?: 'none' | 'pending' | 'approved' | 'rejected'
}

interface ActionSectionProps {
  tasks: Task[]
  totalCount: number
  waitingMessage?: string
  selectedTaskId?: string
  onApprove?: (id: string, comment: string) => Promise<void>
  onRequestChanges?: (id: string, comment: string) => Promise<void>
  onViewDetail?: (id: string) => void
  maxDisplay?: number
  /** Portal preview mode: forwarded to each ActionCard to hide 承認/修正依頼. */
  readOnly?: boolean
}

export function ActionSection({
  tasks,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  totalCount,
  waitingMessage,
  selectedTaskId,
  onApprove,
  onRequestChanges,
  onViewDetail,
  maxDisplay = 5,
  readOnly = false,
}: ActionSectionProps) {
  const displayTasks = tasks.slice(0, maxDisplay)

  return (
    <div className="h-full flex flex-col" data-walkthrough="portal-action-section">
      {/* Task List - Cards float directly in the space */}
      <div className="space-y-3 flex-1 overflow-y-auto pr-1">
        {displayTasks.length === 0 ? (
          // waitingMessage が来ている場合はそれを単一の空状態メッセージとして使う
          // (以前は上部バナー + このカード見出し/本文の3つが同時表示されていた, B5)
          <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
            <div className="w-12 h-12 mb-3 bg-gray-50 rounded-full flex items-center justify-center text-emerald-500">
              <CheckCircle className="w-6 h-6" weight="fill" />
            </div>
            <h3 className="text-gray-900 font-semibold text-sm">
              {waitingMessage || 'すべて確認済みです'}
            </h3>
          </div>
        ) : (
          displayTasks.map((task) => (
            <div key={task.id} className="transition-transform duration-300 hover:translate-x-1">
              <ActionCard
                id={task.id}
                title={task.title}
                dueDate={task.dueDate}
                isOverdue={task.isOverdue}
                waitingDays={task.waitingDays}
                type={task.type}
                estimatedCost={task.estimatedCost}
                estimateStatus={task.estimateStatus}
                selected={selectedTaskId === task.id}
                onApprove={onApprove}
                onRequestChanges={onRequestChanges}
                onViewDetail={onViewDetail}
                readOnly={readOnly}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
