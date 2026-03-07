'use client'

import { useState } from 'react'
import { CheckCircle, ArrowCounterClockwise, CaretDown, CaretUp, ClipboardText } from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface HistoryItem {
  id: string
  taskId: string
  taskTitle: string
  taskType: 'task' | 'spec'
  action: 'task_approved' | 'changes_requested'
  comment?: string
  timestamp: string
}

interface CompletedTask {
  id: string
  title: string
  type: 'task' | 'spec'
  completedAt: string
}

interface PortalHistoryClientProps {
  currentProject: Project
  projects: Project[]
  history: HistoryItem[]
  completedTasks: CompletedTask[]
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateShort(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
  })
}

export function PortalHistoryClient({
  currentProject,
  projects,
  history,
  completedTasks,
}: PortalHistoryClientProps) {
  const [activeTab, setActiveTab] = useState<'actions' | 'completed'>('actions')
  const [showAll, setShowAll] = useState(false)

  const displayedHistory = showAll ? history : history.slice(0, 10)
  const displayedCompleted = showAll ? completedTasks : completedTasks.slice(0, 10)

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
        {/* Page Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">履歴</h1>
          <p className="mt-1 text-sm text-gray-600">
            過去のアクションと完了したタスクの履歴です
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
          <button
            onClick={() => setActiveTab('actions')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'actions'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            アクション履歴
            {history.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-gray-200 rounded">
                {history.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('completed')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'completed'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            完了タスク
            {completedTasks.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-gray-200 rounded">
                {completedTasks.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        {activeTab === 'actions' ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            {history.length === 0 ? (
              <div className="p-8 text-center">
                <ClipboardText className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600">アクション履歴はまだありません</p>
                <p className="text-sm text-gray-400 mt-1">
                  タスクの承認・修正依頼を行うと、ここに記録されます
                </p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-100">
                  {displayedHistory.map((item) => (
                    <div key={item.id} className="px-4 py-4 flex items-start gap-3">
                      {item.action === 'task_approved' ? (
                        <CheckCircle
                          weight="fill"
                          className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5"
                        />
                      ) : (
                        <ArrowCounterClockwise
                          className="w-5 h-5 text-amber-500 shrink-0 mt-0.5"
                        />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {item.taskTitle}
                          </span>
                          {item.taskType === 'spec' && (
                            <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                              仕様
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
                          <span>
                            {item.action === 'task_approved' ? '承認済み' : '修正依頼'}
                          </span>
                          <span>・</span>
                          <span>{formatDate(item.timestamp)}</span>
                        </div>
                        {item.comment && (
                          <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                            {item.comment}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {history.length > 10 && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                    >
                      {showAll ? (
                        <>
                          <CaretUp className="w-4 h-4" />
                          折りたたむ
                        </>
                      ) : (
                        <>
                          <CaretDown className="w-4 h-4" />
                          すべて表示 ({history.length}件)
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            {completedTasks.length === 0 ? (
              <div className="p-8 text-center">
                <CheckCircle className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-600">完了したタスクはまだありません</p>
                <p className="text-sm text-gray-400 mt-1">
                  タスクが完了すると、ここに表示されます
                </p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-gray-100">
                  {displayedCompleted.map((task) => (
                    <div key={task.id} className="px-4 py-3 flex items-center gap-3">
                      <CheckCircle
                        weight="fill"
                        className="w-5 h-5 text-emerald-500 shrink-0"
                      />
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-sm text-gray-700 truncate">
                          {task.title}
                        </span>
                        {task.type === 'spec' && (
                          <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded shrink-0">
                            仕様
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400 shrink-0">
                        {formatDateShort(task.completedAt)}
                      </span>
                    </div>
                  ))}
                </div>
                {completedTasks.length > 10 && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <button
                      onClick={() => setShowAll(!showAll)}
                      className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"
                    >
                      {showAll ? (
                        <>
                          <CaretUp className="w-4 h-4" />
                          折りたたむ
                        </>
                      ) : (
                        <>
                          <CaretDown className="w-4 h-4" />
                          すべて表示 ({completedTasks.length}件)
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </PortalShell>
  )
}
