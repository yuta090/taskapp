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
}: ActionSectionProps) {
  const displayTasks = tasks.slice(0, maxDisplay)

  return (
    <div className="h-full flex flex-col">
      {/* Header Info - optional supplementary text */}
      {waitingMessage && (
        <div className="mb-4 text-xs text-gray-500 font-medium px-1">
          {waitingMessage}
        </div>
      )}

      {/* Task List - Cards float directly in the space */}
      <div className="space-y-3 flex-1 overflow-y-auto pr-1">
        {displayTasks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-60">
            <div className="w-12 h-12 mb-3 bg-gray-50 rounded-full flex items-center justify-center text-emerald-500">
              <CheckCircle className="w-6 h-6" weight="fill" />
            </div>
            <h3 className="text-gray-900 font-bold text-sm">全て完了しています</h3>
            <p className="text-xs text-gray-500 mt-1">現在ボールを持っているタスクはありません。</p>
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
                selected={selectedTaskId === task.id}
                onApprove={onApprove}
                onRequestChanges={onRequestChanges}
                onViewDetail={onViewDetail}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}
