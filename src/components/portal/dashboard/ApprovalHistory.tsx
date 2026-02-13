'use client'

import { useState } from 'react'
import { CaretDown, CaretUp, CheckCircle } from '@phosphor-icons/react'

interface Approval {
  id: string
  taskTitle: string
  approvedAt: string
  comment?: string
}

interface ApprovalHistoryProps {
  approvals: Approval[]
  defaultCollapsed?: boolean
  className?: string
}

function formatDate(date: string): string {
  const d = new Date(date)
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

export function ApprovalHistory({
  approvals,
  defaultCollapsed = true,
  className = '',
}: ApprovalHistoryProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  if (approvals.length === 0) {
    return null
  }

  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm ${className}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-gray-700">承認履歴</h3>
          <span className="px-1.5 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
            {approvals.length}件
          </span>
        </div>
        {collapsed ? (
          <CaretDown className="w-5 h-5 text-gray-400" />
        ) : (
          <CaretUp className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {approvals.map((approval) => (
            <div key={approval.id} className="px-4 py-3 flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" weight="fill" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-700 truncate">{approval.taskTitle}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(approval.approvedAt)} 承認済み
                </p>
                {approval.comment && (
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                    「{approval.comment}」
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
