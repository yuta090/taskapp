'use client'

import { useState, useEffect, useRef } from 'react'
import {
  X,
  Play,
  Stop,
  Calendar,
  Users,
  FileText,
  ListChecks,
  ArrowRight,
  CheckCircle,
  CircleNotch,
  ArrowSquareOut,
  Trash,
} from '@phosphor-icons/react'
import { AmberBadge, useConfirmDialog } from '@/components/shared'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import type { Meeting, MeetingParticipant } from '@/types/database'
import type { MinutesPreviewResult, ParseMinutesResult } from '@/lib/hooks/useMeetings'

interface MeetingInspectorProps {
  meeting: Meeting
  participants?: MeetingParticipant[]
  onClose: () => void
  onStart?: () => void
  onEnd?: () => void
  /** C2: 会議と議事録を削除する。日程調整に紐づく場合は失敗する */
  onDelete?: () => Promise<void>
  /** AT-005/#87: 議事録から SPEC 行のタスク化候補をプレビュー（生成はしない） */
  onPreviewMinutes?: (meetingId: string, minutesMd: string) => Promise<MinutesPreviewResult>
  /** AT-005/#87: 議事録の未処理 SPEC 行をタスク化して結果を返す */
  onCreateTasks?: (meetingId: string, minutesMd: string) => Promise<ParseMinutesResult>
}

type Tab = 'info' | 'minutes' | 'decisions'

export function MeetingInspector({
  meeting,
  participants = [],
  onClose,
  onStart,
  onEnd,
  onDelete,
  onPreviewMinutes,
  onCreateTasks,
}: MeetingInspectorProps) {
  const [activeTab, setActiveTab] = useState<Tab>('info')

  // #87: 議事録→タスク化
  const [preview, setPreview] = useState<MinutesPreviewResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState<ParseMinutesResult | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)

  // C2: 会議削除
  const { confirm, ConfirmDialog } = useConfirmDialog()
  const [isDeleting, setIsDeleting] = useState(false)

  // C1: 参加者の user_id を表示名に解決（未解決時もUUIDは出さない）
  const { members } = useSpaceMembers(meeting.space_id)
  const resolveParticipantName = (userId: string): string =>
    members.find((m) => m.id === userId)?.displayName || 'メンバー'

  const clientParticipants = participants.filter((p) => p.side === 'client')
  const internalParticipants = participants.filter((p) => p.side === 'internal')

  const canStart = meeting.status === 'planned'
  const canEnd = meeting.status === 'in_progress'

  // 会議ごとに一度だけプレビューを走らせるためのキー（自前 setState での再実行を防ぐ）
  const previewKeyRef = useRef<string | null>(null)

  // 別会議に切り替わったらタスク化の状態をリセット
  useEffect(() => {
    previewKeyRef.current = null
    setPreview(null)
    setCreateResult(null)
    setTaskError(null)
  }, [meeting.id])

  // 議事録タブを開いたときに一度だけタスク化候補をプレビュー
  useEffect(() => {
    if (activeTab !== 'minutes') return
    if (!meeting.minutes_md || !onPreviewMinutes) return
    if (createResult) return
    if (previewKeyRef.current === meeting.id) return
    previewKeyRef.current = meeting.id
    let cancelled = false
    setPreviewLoading(true)
    onPreviewMinutes(meeting.id, meeting.minutes_md)
      .then((result) => {
        if (!cancelled) setPreview(result)
      })
      .catch(() => {
        if (!cancelled) setTaskError('タスク化候補の取得に失敗しました')
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, meeting.id, meeting.minutes_md, onPreviewMinutes, createResult])

  const handleDelete = async () => {
    const ok = await confirm({
      title: '会議を削除',
      message: 'この会議と議事録は完全に削除されます。この操作は取り消せません。',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      await onDelete?.()
      onClose()
    } catch {
      setIsDeleting(false)
    }
  }

  const handleTaskify = async () => {
    if (!onCreateTasks || !meeting.minutes_md) return
    setCreating(true)
    setTaskError(null)
    try {
      const result = await onCreateTasks(meeting.id, meeting.minutes_md)
      setCreateResult(result)
      setPreview(null)
    } catch {
      setTaskError('タスク化に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {ConfirmDialog}
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-900 truncate">
          会議詳細
        </h2>
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="meeting-inspector-delete"
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50"
              title="会議を削除"
            >
              <Trash className="text-lg" />
            </button>
          )}
          <button
            onClick={onClose}
            data-testid="meeting-inspector-close"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="会議詳細を閉じる"
          >
            <X className="text-lg" />
          </button>
        </div>
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
                    <AmberBadge>外部</AmberBadge>
                  </div>
                  <div className="space-y-1">
                    {clientParticipants.map((p) => (
                      <div key={p.id} className="text-sm text-gray-700">
                        {resolveParticipantName(p.user_id)}
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
                        {resolveParticipantName(p.user_id)}
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
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
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
              <>
                {/* #87: 議事録→タスク化パネル */}
                {onPreviewMinutes && (
                  <div
                    data-testid="minutes-task-panel"
                    className="rounded-lg border border-gray-200 p-3 space-y-3"
                  >
                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
                      <ListChecks className="text-sm" />
                      決定事項のタスク化
                    </div>

                    {taskError && (
                      <p className="text-xs text-red-600" role="alert">
                        {taskError}
                      </p>
                    )}

                    {createResult ? (
                      // 作成結果
                      <div data-testid="minutes-task-result" className="space-y-2">
                        <div className="flex items-center gap-1.5 text-sm text-green-700">
                          <CheckCircle weight="fill" className="text-base" />
                          {createResult.createdCount}件のタスクを作成しました
                        </div>
                        <ul className="space-y-1">
                          {createResult.createdTasks.map((t) => (
                            <li
                              key={t.taskId}
                              className="text-xs text-gray-600 flex items-center gap-1"
                            >
                              <ArrowSquareOut className="text-gray-400 flex-shrink-0" />
                              <span className="truncate">{t.title}</span>
                              {t.dueDate && (
                                <span className="text-gray-400">（{t.dueDate}）</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : previewLoading ? (
                      <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        <CircleNotch className="animate-spin" />
                        候補を確認中…
                      </div>
                    ) : preview && preview.newSpecCount > 0 ? (
                      <>
                        <ul className="space-y-1.5">
                          {preview.newSpecs.map((s) => (
                            <li
                              key={s.lineNumber}
                              data-testid="minutes-task-candidate"
                              className="flex items-start gap-1.5 text-sm text-gray-700"
                            >
                              <span className="mt-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-900" />
                              <div className="min-w-0">
                                <div className="truncate">{s.title}</div>
                                <div className="truncate text-xs text-gray-400">
                                  {s.specPath}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                        {preview.existingSpecCount > 0 && (
                          <p
                            data-testid="minutes-task-existing"
                            className="text-xs text-gray-400"
                          >
                            作成済み {preview.existingSpecCount}件はスキップします
                          </p>
                        )}
                        <button
                          onClick={handleTaskify}
                          disabled={creating || !onCreateTasks}
                          data-testid="minutes-taskify-button"
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                          {creating ? (
                            <CircleNotch className="animate-spin" />
                          ) : (
                            <ListChecks weight="fill" />
                          )}
                          {creating
                            ? '作成中…'
                            : `${preview.newSpecCount}件をタスク化`}
                        </button>
                      </>
                    ) : preview ? (
                      <p
                        data-testid="minutes-task-empty"
                        className="text-xs text-gray-400"
                      >
                        タスク化できる決定事項はありません
                      </p>
                    ) : null}
                  </div>
                )}

                <div className="prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap text-sm text-gray-700 bg-gray-50 p-3 rounded-lg">
                    {meeting.minutes_md}
                  </pre>
                </div>
              </>
            ) : (
              <div className="text-center py-10 text-gray-400">
                <FileText className="text-4xl mx-auto mb-2 opacity-50" />
                <p className="text-sm">議事録はまだありません。会議終了後にここに表示されます。</p>
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
