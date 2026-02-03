'use client'

import { useState } from 'react'
import {
  X,
  Play,
  Stop,
  Calendar,
  Users,
  FileText,
  ListChecks,
  ArrowRight,
} from '@phosphor-icons/react'
import { AmberBadge } from '@/components/shared'
import type { Meeting, MeetingParticipant } from '@/types/database'

interface MeetingInspectorProps {
  meeting: Meeting
  participants?: MeetingParticipant[]
  onClose: () => void
  onStart?: () => void
  onEnd?: () => void
}

type Tab = 'info' | 'minutes' | 'decisions'

export function MeetingInspector({
  meeting,
  participants = [],
  onClose,
  onStart,
  onEnd,
}: MeetingInspectorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('info')

  const clientParticipants = participants.filter((p) => p.side === 'client')
  const internalParticipants = participants.filter((p) => p.side === 'internal')

  // AT-001: クライアント参加者がいない場合は開始不可
  const hasClientParticipants = clientParticipants.length > 0
  // AT-002: plannedかつクライアント参加者がいる場合のみ開始可能
  const canStart = meeting.status === 'planned' && hasClientParticipants
  const canEnd = meeting.status === 'in_progress'
  // 開始できない理由
  const startDisabledReason = meeting.status === 'planned' && !hasClientParticipants
    ? 'クライアント参加者を追加してください'
    : null

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-900 truncate">
          会議詳細
        </h2>
        <button
          onClick={onClose}
          data-testid="meeting-inspector-close"
          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
        >
          <X className="text-lg" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-100 px-4">
        {[
          { id: 'info' as Tab, label: '概要', icon: <FileText /> },
          { id: 'minutes' as Tab, label: '議事録', icon: <ListChecks /> },
          { id: 'decisions' as Tab, label: '決定事項', icon: <ArrowRight /> },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`meeting-inspector-tab-${tab.id}`}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'text-gray-900 border-gray-900'
                : 'text-gray-500 border-transparent hover:text-gray-700'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'info' && (
          <div className="space-y-6">
            {/* Title & Status */}
            <div>
              <h3 className="text-base font-medium text-gray-900">
                {meeting.title}
              </h3>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`px-2 py-0.5 text-xs font-medium rounded ${
                    meeting.status === 'in_progress'
                      ? 'bg-green-100 text-green-700'
                      : meeting.status === 'ended'
                      ? 'bg-gray-100 text-gray-600'
                      : 'bg-blue-100 text-blue-600'
                  }`}
                >
                  {meeting.status === 'in_progress'
                    ? '進行中'
                    : meeting.status === 'ended'
                    ? '終了'
                    : '予定'}
                </span>
              </div>
            </div>

            {/* Date/Time */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-gray-500">日時</label>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <Calendar className="text-gray-400" />
                <span>
                  {meeting.held_at
                    ? new Date(meeting.held_at).toLocaleString('ja-JP')
                    : '未設定'}
                </span>
              </div>
              {meeting.started_at && (
                <div className="text-xs text-gray-500">
                  開始: {new Date(meeting.started_at).toLocaleTimeString('ja-JP')}
                </div>
              )}
              {meeting.ended_at && (
                <div className="text-xs text-gray-500">
                  終了: {new Date(meeting.ended_at).toLocaleTimeString('ja-JP')}
                </div>
              )}
            </div>

            {/* Participants */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                <Users className="text-sm" />
                参加者
              </label>

              {clientParticipants.length > 0 && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <AmberBadge>クライアント</AmberBadge>
                  </div>
                  <div className="space-y-1">
                    {clientParticipants.map((p) => (
                      <div key={p.id} className="text-sm text-gray-700">
                        {p.user_id}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {internalParticipants.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">社内</div>
                  <div className="space-y-1">
                    {internalParticipants.map((p) => (
                      <div key={p.id} className="text-sm text-gray-700">
                        {p.user_id}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {participants.length === 0 && (
                <div className="text-sm text-gray-400">参加者なし</div>
              )}
            </div>

            {/* Actions */}
            <div className="pt-4 space-y-2">
              {/* AT-002: plannedの場合のみ開始ボタンを表示 */}
              {meeting.status === 'planned' && (
                <>
                  {startDisabledReason && (
                    <div className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-lg mb-2">
                      {startDisabledReason}
                    </div>
                  )}
                  <button
                    onClick={onStart}
                    disabled={!canStart}
                    data-testid="meeting-inspector-start"
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                      canStart
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <Play weight="fill" />
                    会議を開始
                  </button>
                </>
              )}
              {canEnd && (
                <button
                  onClick={onEnd}
                  data-testid="meeting-inspector-end"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Stop weight="fill" />
                  会議を終了
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'minutes' && (
          <div className="space-y-4">
            {meeting.minutes_md ? (
              <div className="prose prose-sm max-w-none">
                <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">
                  {meeting.minutes_md}
                </pre>
              </div>
            ) : (
              <div className="text-center py-10 text-gray-400">
                <FileText className="text-4xl mx-auto mb-2 opacity-50" />
                <p className="text-sm">議事録はありません</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'decisions' && (
          <div className="space-y-4">
            {meeting.summary_body ? (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">
                  {meeting.summary_subject}
                </h4>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {meeting.summary_body}
                </p>
              </div>
            ) : (
              <div className="text-center py-10 text-gray-400">
                <ListChecks className="text-4xl mx-auto mb-2 opacity-50" />
                <p className="text-sm">決定事項はありません</p>
                {meeting.status !== 'ended' && (
                  <p className="text-xs mt-1">会議終了後に生成されます</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
