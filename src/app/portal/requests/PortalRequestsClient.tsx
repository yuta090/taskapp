'use client'

import { useState } from 'react'
import { PaperPlaneTilt, Circle, CheckCircle, Clock, CaretRight } from '@phosphor-icons/react'
import { PortalShell, PortalTaskInspector } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Request {
  id: string
  title: string
  status: string
  ball: string
  dueDate: string | null
  type: 'task' | 'spec'
  createdAt: string
  description: string | null
}

interface PortalRequestsClientProps {
  currentProject: Project
  projects: Project[]
  requests: Request[]
  actionCount?: number
}

type FilterKey = 'all' | 'active' | 'done'

function getStatusDisplay(status: string, ball: string): { label: string; color: string; icon: React.ElementType } {
  if (status === 'done') {
    return { label: '完了', color: 'text-green-500', icon: CheckCircle }
  }
  if (ball === 'client') {
    return { label: '要確認', color: 'text-amber-500', icon: Circle }
  }
  if (status === 'in_progress') {
    return { label: '対応中', color: 'text-blue-400', icon: Clock }
  }
  return { label: 'チーム対応中', color: 'text-gray-400', icon: Circle }
}

function getCategoryFromTitle(title: string): { label: string; color: string } {
  if (title.startsWith('[BUG]')) {
    return { label: 'バグ報告', color: 'bg-red-50 text-red-700' }
  }
  if (title.startsWith('[REQ]')) {
    return { label: '機能要望', color: 'bg-purple-50 text-purple-700' }
  }
  if (title.startsWith('[Q&A]')) {
    return { label: '質問', color: 'bg-blue-50 text-blue-700' }
  }
  return { label: 'リクエスト', color: 'bg-gray-100 text-gray-600' }
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function stripPrefix(title: string): string {
  return title.replace(/^\[(BUG|REQ|Q&A)\]\s*/, '')
}

export function PortalRequestsClient({
  currentProject,
  projects,
  requests,
  actionCount = 0,
}: PortalRequestsClientProps) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null)

  const filteredRequests = requests.filter(r => {
    if (filter === 'active') return r.status !== 'done'
    if (filter === 'done') return r.status === 'done'
    return true
  })

  const activeCount = requests.filter(r => r.status !== 'done').length
  const doneCount = requests.filter(r => r.status === 'done').length

  const inspector = selectedRequest ? (
    <PortalTaskInspector
      task={{
        id: selectedRequest.id,
        title: selectedRequest.title,
        description: selectedRequest.description,
        status: selectedRequest.status,
        dueDate: selectedRequest.dueDate,
        type: selectedRequest.type,
        createdAt: selectedRequest.createdAt,
      }}
      onClose={() => setSelectedRequest(null)}
    />
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
      inspector={inspector}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">送信したリクエスト</h1>
            <p className="mt-1 text-sm text-gray-600">
              クライアントから送信されたバグ報告・機能要望・質問の一覧です。
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-gray-900">{requests.length}</div>
              <div className="text-sm text-gray-500">全体</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-blue-600">{activeCount}</div>
              <div className="text-sm text-gray-500">対応中</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
              <div className="text-2xl font-bold text-green-600">{doneCount}</div>
              <div className="text-sm text-gray-500">完了</div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
            {([
              { key: 'all' as const, label: 'すべて', count: requests.length },
              { key: 'active' as const, label: '対応中', count: activeCount },
              { key: 'done' as const, label: '完了', count: doneCount },
            ]).map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                  filter === tab.key
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-gray-200 rounded">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Request List */}
          {filteredRequests.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <PaperPlaneTilt className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">
                {filter === 'all'
                  ? 'リクエストはまだありません'
                  : filter === 'active'
                  ? '対応中のリクエストはありません'
                  : '完了したリクエストはありません'}
              </p>
              <p className="text-sm text-gray-400 mt-1">
                ダッシュボードの「リクエストを送る」ボタンからバグ報告や機能要望を送信できます
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm divide-y divide-gray-100">
              {filteredRequests.map(request => {
                const statusDisplay = getStatusDisplay(request.status, request.ball)
                const category = getCategoryFromTitle(request.title)
                const StatusIcon = statusDisplay.icon

                return (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => setSelectedRequest(
                      selectedRequest?.id === request.id ? null : request
                    )}
                    className={`w-full text-left px-4 py-3.5 flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                      selectedRequest?.id === request.id ? 'bg-blue-50/50' : ''
                    }`}
                  >
                    <StatusIcon
                      weight={request.status === 'done' ? 'fill' : undefined}
                      className={`w-5 h-5 shrink-0 ${statusDisplay.color}`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">
                          {stripPrefix(request.title)}
                        </span>
                        <span className={`px-1.5 py-0.5 text-xs rounded shrink-0 ${category.color}`}>
                          {category.label}
                        </span>
                        {request.ball === 'client' && request.status !== 'done' && (
                          <span className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded shrink-0">
                            要確認
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                        <span className={statusDisplay.color}>{statusDisplay.label}</span>
                        <span>{formatDate(request.createdAt)}</span>
                      </div>
                    </div>
                    <CaretRight className="w-4 h-4 text-gray-400 shrink-0" />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
