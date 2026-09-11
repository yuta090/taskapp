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
  ArrowCounterClockwise,
  CurrencyJpy,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { PortalShell } from '@/components/portal'
import { resolvePortalConflictMessage } from '@/lib/portal/resolvePortalConflictMessage'

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
  estimatedCost?: number | null
  estimateStatus?: 'none' | 'pending' | 'approved' | 'rejected'
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

import { PORTAL_STATUS_LABELS, PORTAL_BALL_LABELS } from '@/components/portal/labels'

const statusLabels = PORTAL_STATUS_LABELS
const ballLabels = PORTAL_BALL_LABELS

/** 本当に他の誰かが先に操作していた場合（API が理由を返さない場合）に表示する既定文言。 */
const STALE_CONFLICT_MESSAGE = '他のユーザーが先に操作しました。画面を更新します。'

type PortalTaskAction = 'approve' | 'request_changes' | 'estimate_approve' | 'estimate_reject'

/** 送信中のボタンに出すくるくる（4つの送信処理で共通利用）。 */
function ButtonSpinner() {
  return (
    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
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

  /**
   * 承認・修正依頼・見積もり承認・再見積もり依頼の4つの送信処理を1つにまとめたもの。
   * 成功・409・401・403・400・想定外エラーの扱いはどの操作でも同じにする。
   * 成功時は router.push('/portal') で画面が切り替わるまでボタンを押させない
   * ため isSubmitting を戻さない。失敗したときだけ戻して再操作できるようにする。
   */
  const submitAction = async (
    action: PortalTaskAction,
    options: { successMessage: string; requireCommentMessage?: string }
  ) => {
    if (options.requireCommentMessage && !comment.trim()) {
      toast.warning(options.requireCommentMessage)
      return
    }
    if (isSubmitting) return
    setIsSubmitting(true)

    try {
      const response = await fetch(`/api/portal/tasks/${task.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, comment }),
      })

      if (response.ok) {
        toast.success(options.successMessage)
        router.push('/portal')
        return
      }

      const errorData = await response.json().catch(() => ({} as { error?: string; reason?: string }))

      if (response.status === 409) {
        toast.error(resolvePortalConflictMessage(errorData, STALE_CONFLICT_MESSAGE))
        // この画面は見積もりの状態でボタンを切り替えるので、業務の理由の409でも
        // 取り直して最新の状態を出す。
        router.refresh()
      } else if (response.status === 401) {
        toast.error('セッションが切れました。再度アクセスしてください。')
        router.push('/login')
      } else if (response.status === 403) {
        // mfaGuardResponse（二要素認証のコード未入力）とアクセス権限なしは、
        // どちらもステータス 403 だが error コードで区別できる。前者は
        // 何をすればよいか分かる文言にする。
        toast.error(
          errorData.error === 'mfa_required'
            ? '二要素認証のコード入力が必要です。ログイン画面からやり直してください。'
            : 'このタスクにはアクセスできません。'
        )
      } else if (response.status === 400) {
        toast.error(errorData.error || 'コメントを入力してください。')
      } else {
        toast.error('操作に失敗しました。しばらくしてからお試しください。')
      }
      setIsSubmitting(false)
    } catch (error) {
      console.error(`Portal task action failed (${action}):`, error)
      toast.error('ネットワークエラーが発生しました。しばらくしてからお試しください。')
      setIsSubmitting(false)
    }
  }

  const handleApprove = () => submitAction('approve', { successMessage: '承認しました' })
  const handleRequestChanges = () =>
    submitAction('request_changes', {
      successMessage: '修正依頼を送信しました',
      requireCommentMessage: '修正内容を入力してください',
    })
  const handleEstimateApprove = () =>
    submitAction('estimate_approve', { successMessage: '見積もりを承認しました' })
  const handleEstimateReject = () =>
    submitAction('estimate_reject', {
      successMessage: '再見積もりを依頼しました',
      requireCommentMessage: '再見積もり依頼の理由を入力してください',
    })

  const isClientBall = task.ball === 'client'
  const canTakeAction = isClientBall && task.status !== 'done'
  // 見積もり確認待ちは通常の承認/修正依頼ではなく見積もりの承認・却下を出す。
  // 通常のボタンを出すと押した瞬間にサーバーが409(見積もりの確認が必要)で
  // 断ってしまい先に進めなくなる（要対応一覧・PortalTaskInspector と同じ切り分け）。
  const isEstimatePending = task.estimateStatus === 'pending' && task.estimatedCost != null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
        {/* Back link — carries ?space= so it returns to this task's own
            project's list, not whichever project happens to be first (S6) */}
        <Link
          href={projects.length > 1 ? `/portal/tasks?space=${currentProject.id}` : '/portal/tasks'}
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          要対応一覧に戻る
        </Link>

        {/* Task Header */}
        <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                {task.type === 'spec' && (
                  <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
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
              <h1 className="text-xl font-semibold text-gray-900">{task.title}</h1>
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
          <div className="bg-surface rounded-xl border border-gray-200 shadow-sm">
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
          <div className="bg-surface rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-sm font-medium text-gray-700 mb-4">アクション</h3>

            {/* Estimate banner — shown when estimate is pending, mirrors PortalTaskInspector */}
            {isEstimatePending && (
              <div className="mb-4 px-4 py-3 rounded-lg border border-amber-200 bg-amber-50/80">
                <div className="flex items-center gap-2 mb-1">
                  <CurrencyJpy className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-medium text-amber-700">見積もり確認</span>
                </div>
                <div className="text-2xl font-semibold text-gray-900 tracking-tight">
                  ¥{task.estimatedCost!.toLocaleString()}
                </div>
              </div>
            )}

            {/* Comment input */}
            <div className="mb-4">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={isEstimatePending ? 'コメントを入力（再見積もり依頼時は必須）' : 'コメントを入力（任意）'}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 resize-none"
                rows={3}
              />
            </div>

            {/* Action buttons — estimate vs regular, mirrors PortalTaskInspector */}
            {isEstimatePending ? (
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleEstimateApprove}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <ButtonSpinner />
                  ) : (
                    <Checks className="w-4 h-4" />
                  )}
                  {isSubmitting ? '処理中...' : '見積もり承認'}
                </button>
                <button
                  onClick={handleEstimateReject}
                  disabled={isSubmitting || !comment.trim()}
                  aria-busy={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-100 text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <ButtonSpinner />
                  ) : (
                    <ArrowCounterClockwise className="w-4 h-4" />
                  )}
                  {isSubmitting ? '送信中...' : '再見積もり依頼'}
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleApprove}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <ButtonSpinner />
                  ) : (
                    <Checks className="w-4 h-4" />
                  )}
                  {isSubmitting ? '承認中...' : '承認する'}
                </button>
                <button
                  onClick={handleRequestChanges}
                  disabled={isSubmitting}
                  aria-busy={isSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-surface border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? (
                    <ButtonSpinner />
                  ) : (
                    <PaperPlaneTilt className="w-4 h-4" />
                  )}
                  {isSubmitting ? '送信中...' : '修正を依頼'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Status info for non-actionable tasks */}
        {!canTakeAction && (
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 text-center">
            {task.status === 'done' ? (
              <div className="flex items-center justify-center gap-2 text-green-600">
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
      </div>
    </PortalShell>
  )
}
