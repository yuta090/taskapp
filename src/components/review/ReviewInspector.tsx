'use client'

import { useState } from 'react'
import {
  X,
  CheckCircle,
  XCircle,
  Clock,
  User,
  ChatText,
} from '@phosphor-icons/react'
import type { Review, ReviewApproval, Task } from '@/types/database'

interface ReviewInspectorProps {
  review: Review
  task?: Task
  approvals?: ReviewApproval[]
  onClose: () => void
  onApprove?: () => void
  onBlock?: (reason: string) => void
}

export function ReviewInspector({
  review,
  task,
  approvals = [],
  onClose,
  onApprove,
  onBlock,
}: ReviewInspectorProps) {
  const [blockReason, setBlockReason] = useState('')
  const [showBlockForm, setShowBlockForm] = useState(false)

  const handleBlock = () => {
    if (!blockReason.trim()) {
      alert('差し戻し理由を入力してください')
      return
    }
    onBlock?.(blockReason.trim())
    setBlockReason('')
    setShowBlockForm(false)
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-900 truncate">
          レビュー詳細
        </h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
        >
          <X className="text-lg" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Task info */}
        {task && (
          <div>
            <h3 className="text-base font-medium text-gray-900">
              {task.title}
            </h3>
            {task.description && (
              <p className="mt-2 text-sm text-gray-600">{task.description}</p>
            )}
          </div>
        )}

        {/* Status */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">ステータス</label>
          <div className="flex items-center gap-2">
            {review.status === 'approved' ? (
              <CheckCircle weight="fill" className="text-green-500" />
            ) : review.status === 'changes_requested' ? (
              <XCircle weight="fill" className="text-red-500" />
            ) : (
              <Clock className="text-amber-500" />
            )}
            <span
              className={`text-sm font-medium ${
                review.status === 'approved'
                  ? 'text-green-700'
                  : review.status === 'changes_requested'
                  ? 'text-red-700'
                  : 'text-amber-700'
              }`}
            >
              {review.status === 'approved'
                ? '承認済み'
                : review.status === 'changes_requested'
                ? '差し戻し'
                : 'レビュー待ち'}
            </span>
          </div>
        </div>

        {/* Approvals */}
        <div className="space-y-3">
          <label className="text-xs font-medium text-gray-500">
            レビュアー
          </label>
          <div className="space-y-2">
            {approvals.map((approval) => (
              <div
                key={approval.id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <User className="text-gray-400" />
                  <span className="text-sm">{approval.reviewer_id}</span>
                </div>
                <span
                  className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                    approval.state === 'approved'
                      ? 'bg-green-100 text-green-700'
                      : approval.state === 'blocked'
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {approval.state === 'approved'
                    ? '承認'
                    : approval.state === 'blocked'
                    ? '差し戻し'
                    : '未対応'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Blocked reasons */}
        {approvals.some((a) => a.state === 'blocked' && a.blocked_reason) && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-red-600">
              差し戻し理由
            </label>
            {approvals
              .filter((a) => a.state === 'blocked' && a.blocked_reason)
              .map((a) => (
                <div
                  key={a.id}
                  className="p-2 bg-red-50 border border-red-100 rounded-lg"
                >
                  <div className="flex items-center gap-1 text-xs text-red-600 mb-1">
                    <ChatText />
                    {a.reviewer_id}
                  </div>
                  <p className="text-sm text-red-700">{a.blocked_reason}</p>
                </div>
              ))}
          </div>
        )}

        {/* Actions */}
        {review.status === 'open' && (
          <div className="pt-4 space-y-3">
            {!showBlockForm ? (
              <>
                <button
                  onClick={onApprove}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  <CheckCircle weight="bold" />
                  承認する
                </button>
                <button
                  onClick={() => setShowBlockForm(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <XCircle weight="bold" />
                  差し戻す
                </button>
              </>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="差し戻し理由を入力..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-red-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowBlockForm(false)}
                    className="flex-1 px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    onClick={handleBlock}
                    className="flex-1 px-3 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    差し戻す
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
