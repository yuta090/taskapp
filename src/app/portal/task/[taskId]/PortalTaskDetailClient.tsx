'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft,
  Calendar,
  Clock,
  CheckCircle,
  Warning,
  PaperPlaneTilt,
  FileText,
  Checks,
} from '@phosphor-icons/react'
import { PortalLayout } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface Task {
  id: string
  title: string
  description?: string
  status: string
  ball: string
  type: 'task' | 'spec'
  dueDate?: string | null
  specPath?: string | null
  decisionState?: string | null
  createdAt: string
  updatedAt: string
  waitingDays: number
  isOverdue: boolean
}

interface Comment {
  id: string
  content: string
  createdAt: string
  author: string
}

interface PortalTaskDetailClientProps {
  currentProject: Project
  projects: Project[]
  task: Task
  comments: Comment[]
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function formatDateTime(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const statusLabels: Record<string, string> = {
  open: '未着手',
  in_progress: '進行中',
  todo: 'TODO',
  considering: '検討中',
  done: '完了',
}

const ballLabels: Record<string, string> = {
  client: 'お客様',
  internal: '開発チーム',
}

export function PortalTaskDetailClient({
  currentProject,
  projects,
  task,
  comments,
}: PortalTaskDetailClientProps) {
  const router = useRouter()
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleProjectChange = () => {
    router.refresh()
  }

  const handleApprove = async () => {
    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/portal/tasks/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', comment }),
      })

      if (response.ok) {
        router.push('/portal')
        router.refresh()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleRequestChanges = async () => {
    if (!comment.trim()) {
      alert('修正内容を入力してください')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/portal/tasks/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request_changes', comment }),
      })

      if (response.ok) {
        router.push('/portal')
        router.refresh()
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const isClientBall = task.ball === 'client'
  const canTakeAction = isClientBall && task.status !== 'done'

  return (
    <PortalLayout
      currentProject={currentProject}
      projects={projects}
      onProjectChange={handleProjectChange}
    >
      <div className="space-y-6">
        {/* Back link */}
        <Link
          href="/portal/tasks"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          要対応一覧に戻る
        </Link>

        {/* Task Header */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {task.type === 'spec' && (
                  <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                    仕様
                  </span>
                )}
                <span className={`px-2 py-0.5 text-xs rounded ${
                  isClientBall
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {ballLabels[task.ball] || task.ball}
                </span>
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                  {statusLabels[task.status] || task.status}
                </span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">{task.title}</h1>
            </div>
          </div>

          {/* Meta info */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            {task.dueDate && (
              <div className={`flex items-center gap-1.5 ${
                task.isOverdue ? 'text-red-600' : 'text-gray-600'
              }`}>
                <Calendar className="w-4 h-4" />
                <span>期限: {formatDate(task.dueDate)}</span>
                {task.isOverdue && (
                  <Warning weight="fill" className="w-4 h-4" />
                )}
              </div>
            )}
            {task.waitingDays > 0 && (
              <div className="flex items-center gap-1.5 text-gray-600">
                <Clock className="w-4 h-4" />
                <span>{task.waitingDays}日経過</span>
              </div>
            )}
          </div>

          {/* Description */}
          {task.description && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h3 className="text-sm font-medium text-gray-700 mb-2">説明</h3>
              <div className="text-sm text-gray-600 whitespace-pre-wrap">
                {task.description}
              </div>
            </div>
          )}

          {/* Spec info */}
          {task.type === 'spec' && task.specPath && (
            <div className="mt-6 pt-6 border-t border-gray-100">
              <h3 className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                <FileText className="w-4 h-4" />
                仕様書
              </h3>
              <a
                href={task.specPath}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-amber-600 hover:underline"
              >
                {task.specPath}
              </a>
            </div>
          )}
        </div>

        {/* Comments */}
        {comments.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-medium text-gray-700">コメント ({comments.length})</h3>
            </div>
            <div className="divide-y divide-gray-100">
              {comments.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-900">{c.author}</span>
                    <span className="text-xs text-gray-400">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Section */}
        {canTakeAction && (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-sm font-medium text-gray-700 mb-4">アクション</h3>

            {/* Comment input */}
            <div className="mb-4">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="コメントを入力（任意）"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
                rows={3}
              />
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={handleApprove}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <Checks className="w-4 h-4" />
                承認する
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={isSubmitting}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                <PaperPlaneTilt className="w-4 h-4" />
                修正を依頼
              </button>
            </div>
          </div>
        )}

        {/* Status info for non-actionable tasks */}
        {!canTakeAction && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 text-center">
            {task.status === 'done' ? (
              <div className="flex items-center justify-center gap-2 text-emerald-600">
                <CheckCircle weight="fill" className="w-5 h-5" />
                <span className="text-sm font-medium">このタスクは完了しています</span>
              </div>
            ) : (
              <div className="text-sm text-gray-600">
                現在、開発チームが対応中です
              </div>
            )}
          </div>
        )}

        {/* Timestamps */}
        <div className="text-xs text-gray-400 flex gap-4">
          <span>作成: {formatDateTime(task.createdAt)}</span>
          <span>更新: {formatDateTime(task.updatedAt)}</span>
        </div>
      </div>
    </PortalLayout>
  )
}
