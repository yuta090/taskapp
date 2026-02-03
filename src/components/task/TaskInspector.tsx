'use client'

import { useState, useEffect, useMemo } from 'react'
import { X, ArrowRight, Circle, User, Calendar, Link as LinkIcon, Trash, PencilSimple, Check, Flag } from '@phosphor-icons/react'
import { AmberBadge } from '@/components/shared'
import { createClient } from '@/lib/supabase/client'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useSpaceSettings } from '@/lib/hooks/useSpaceSettings'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { TaskComments } from './TaskComments'
import { TaskPRList } from '@/components/github'
import type { Task, TaskOwner, TaskStatus, Milestone, DecisionState } from '@/types/database'

interface TaskInspectorProps {
  task: Task
  spaceId: string
  owners?: TaskOwner[]
  onClose: () => void
  onPassBall?: (ball: 'client' | 'internal') => void
  onUpdate?: (updates: {
    title?: string
    description?: string | null
    status?: TaskStatus
    dueDate?: string | null
    milestoneId?: string | null
    assigneeId?: string | null
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onUpdateOwners?: (clientOwnerIds: string[], internalOwnerIds: string[]) => Promise<void>
  /** AT-009: Spec task state transition */
  onSetSpecState?: (decisionState: DecisionState) => Promise<void>
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: '未着手' },
  { value: 'todo', label: 'ToDo' },
  { value: 'in_progress', label: '進行中' },
  { value: 'in_review', label: 'レビュー中' },
  { value: 'done', label: '完了' },
  { value: 'considering', label: '検討中' },
]

export function TaskInspector({
  task,
  spaceId,
  owners = [],
  onClose,
  onPassBall,
  onUpdate,
  onDelete,
  onUpdateOwners,
  onSetSpecState,
}: TaskInspectorProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [editDescription, setEditDescription] = useState(task.description || '')
  const [isDeleting, setIsDeleting] = useState(false)

  // AT-009: Spec task 2-click workflow state
  const [specConfirmClickTime, setSpecConfirmClickTime] = useState<number | null>(null)
  const [specConfirmTaskId, setSpecConfirmTaskId] = useState<string | null>(null)
  const [isSettingSpecState, setIsSettingSpecState] = useState(false)

  // Reset spec confirmation state when task changes
  useEffect(() => {
    setSpecConfirmClickTime(null)
    setSpecConfirmTaskId(null)
    setIsSettingSpecState(false)
  }, [task.id])

  // Milestone data
  const [milestones, setMilestones] = useState<Milestone[]>([])

  // Space members with display names
  const { members, clientMembers, internalMembers, getMemberName, loading: membersLoading } = useSpaceMembers(spaceId)

  // FR-OWN-002: 責任者欄の表示/非表示設定
  const { shouldShowOwnerField } = useSpaceSettings(spaceId)

  // Current user for comments
  const { user } = useCurrentUser()
  const currentUserId = user?.id || null
  const isInternalMember = currentUserId ? internalMembers.some(m => m.id === currentUserId) : false

  // Owner editing state
  const [editingOwners, setEditingOwners] = useState(false)
  const [selectedClientOwners, setSelectedClientOwners] = useState<string[]>([])
  const [selectedInternalOwners, setSelectedInternalOwners] = useState<string[]>([])

  const supabase = useMemo(() => createClient(), [])

  const clientOwners = owners.filter((o) => o.side === 'client')
  const internalOwners = owners.filter((o) => o.side === 'internal')

  // FR-ASN-001: ボール連動の担当者選択
  // ball='internal' → 社内メンバーのみ、ball='client' → 全メンバー（社内+クライアント）
  // 注意: 現在の担当者が選択肢にない場合でも表示できるよう含める
  const assignableMembers = useMemo(() => {
    const baseMembers = task.ball === 'client'
      ? [...internalMembers, ...clientMembers]
      : internalMembers

    // 現在の担当者が選択肢に含まれていない場合は追加（不整合状態の表示用）
    if (task.assignee_id && !baseMembers.some((m) => m.id === task.assignee_id)) {
      const currentAssignee = members.find((m) => m.id === task.assignee_id)
      if (currentAssignee) {
        return [...baseMembers, currentAssignee]
      }
    }
    return baseMembers
  }, [task.ball, task.assignee_id, internalMembers, clientMembers, members])

  // Fetch milestones
  useEffect(() => {
    const fetchMilestones = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: msData } = await (supabase as any)
        .from('milestones')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .order('order_key' as never, { ascending: true })

      if (msData) setMilestones(msData)
    }

    void fetchMilestones()
  }, [spaceId, supabase])

  // Initialize owner selection when editing starts
  const handleStartEditingOwners = () => {
    setSelectedClientOwners(clientOwners.map((o) => o.user_id))
    setSelectedInternalOwners(internalOwners.map((o) => o.user_id))
    setEditingOwners(true)
  }

  const handleTitleSave = async () => {
    if (!editTitle.trim() || editTitle === task.title) {
      setEditTitle(task.title)
      setIsEditingTitle(false)
      return
    }
    await onUpdate?.({ title: editTitle.trim() })
    setIsEditingTitle(false)
  }

  const handleDescriptionSave = async () => {
    const newDesc = editDescription.trim() || null
    if (newDesc === (task.description || null)) {
      setIsEditingDescription(false)
      return
    }
    await onUpdate?.({ description: newDesc })
    setIsEditingDescription(false)
  }

  const handleStatusChange = async (status: TaskStatus) => {
    if (status !== task.status) {
      await onUpdate?.({ status })
    }
  }

  const handleDueDateChange = async (dateStr: string) => {
    const dueDate = dateStr || null
    if (dueDate !== task.due_date) {
      await onUpdate?.({ dueDate })
    }
  }

  const handleMilestoneChange = async (milestoneId: string) => {
    const newMilestoneId = milestoneId || null
    if (newMilestoneId !== task.milestone_id) {
      await onUpdate?.({ milestoneId: newMilestoneId })
    }
  }

  const handleAssigneeChange = async (assigneeId: string) => {
    const newAssigneeId = assigneeId || null
    if (newAssigneeId !== task.assignee_id) {
      await onUpdate?.({ assigneeId: newAssigneeId })
    }
  }

  // FR-ASN-003: ボール切り替え時の警告ハンドラー
  const handleBallChange = (newBall: 'client' | 'internal') => {
    // client → internal に切り替え時、担当者が社内メンバーでなければ警告
    // 注意: membersロード中は誤警告を防ぐためスキップ（UIの不整合警告で後から検出可能）
    if (newBall === 'internal' && task.ball === 'client' && task.assignee_id && !membersLoading) {
      const isInternalAssignee = internalMembers.some((m) => m.id === task.assignee_id)
      if (!isInternalAssignee) {
        // 担当者名を取得（clientMembersから、または全membersから）
        const assignee = clientMembers.find((m) => m.id === task.assignee_id)
          || members.find((m) => m.id === task.assignee_id)
        const assigneeName = assignee?.displayName || '現在の担当者'
        const confirmed = confirm(
          `担当者「${assigneeName}」は社内メンバーではありません。\nボールを社内に切り替えると、担当者の変更が必要になる場合があります。\n\n切り替えますか？`
        )
        if (!confirmed) return
      }
    }
    onPassBall?.(newBall)
  }

  const toggleClientOwner = (ownerId: string) => {
    setSelectedClientOwners((prev) =>
      prev.includes(ownerId)
        ? prev.filter((id) => id !== ownerId)
        : [...prev, ownerId]
    )
  }

  const toggleInternalOwner = (ownerId: string) => {
    setSelectedInternalOwners((prev) =>
      prev.includes(ownerId)
        ? prev.filter((id) => id !== ownerId)
        : [...prev, ownerId]
    )
  }

  const handleSaveOwners = async () => {
    await onUpdateOwners?.(selectedClientOwners, selectedInternalOwners)
    setEditingOwners(false)
  }

  const handleDelete = async () => {
    if (!confirm('このタスクを削除しますか？')) return
    setIsDeleting(true)
    try {
      await onDelete?.()
      onClose()
    } catch {
      setIsDeleting(false)
    }
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-sm font-medium text-gray-900 truncate">
          タスク詳細
        </h2>
        <div className="flex items-center gap-1">
          {onDelete && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              data-testid="task-inspector-delete"
              className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-600 disabled:opacity-50"
              title="タスクを削除"
            >
              <Trash className="text-lg" />
            </button>
          )}
          <button
            onClick={onClose}
            data-testid="task-inspector-close"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="text-lg" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Title */}
        <div>
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTitleSave()
                  if (e.key === 'Escape') {
                    setEditTitle(task.title)
                    setIsEditingTitle(false)
                  }
                }}
                data-testid="task-inspector-title-input"
                className="flex-1 px-2 py-1 text-base font-medium border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleTitleSave}
                className="p-1 text-green-600 hover:bg-green-50 rounded"
              >
                <Check className="text-sm" />
              </button>
            </div>
          ) : (
            <div
              className="group flex items-center gap-2 cursor-pointer"
              onClick={() => onUpdate && setIsEditingTitle(true)}
            >
              <h3 className="text-base font-medium text-gray-900">{task.title}</h3>
              {onUpdate && (
                <PencilSimple className="text-sm text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          )}
          {task.ball === 'client' && (
            <div className="mt-2">
              <AmberBadge>クライアント確認待ち</AmberBadge>
            </div>
          )}
        </div>

        {/* Status */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">ステータス</label>
          {onUpdate ? (
            <select
              value={task.status}
              onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
              data-testid="task-inspector-status"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex items-center gap-2">
              <Circle
                weight="fill"
                className={`text-sm ${
                  task.status === 'done'
                    ? 'text-green-500'
                    : task.status === 'in_progress'
                    ? 'text-blue-500'
                    : task.status === 'considering'
                    ? 'text-amber-500'
                    : 'text-gray-300'
                }`}
              />
              <span className="text-sm">
                {STATUS_OPTIONS.find((opt) => opt.value === task.status)?.label || task.status}
              </span>
            </div>
          )}
        </div>

        {/* Ball Ownership */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">ボール</label>
          <div className="flex gap-2">
            <button
              onClick={() => handleBallChange('internal')}
              data-testid="task-inspector-ball-internal"
              className={`flex-1 px-3 py-2 rounded border text-sm transition-colors ${
                task.ball === 'internal'
                  ? 'bg-gray-100 border-gray-300 font-medium'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              社内
            </button>
            <button
              onClick={() => handleBallChange('client')}
              data-testid="task-inspector-ball-client"
              className={`flex-1 px-3 py-2 rounded border text-sm transition-colors ${
                task.ball === 'client'
                  ? 'bg-amber-50 border-amber-300 font-medium text-amber-700'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center justify-center gap-1">
                <ArrowRight weight="bold" className="text-xs" />
                クライアント
              </span>
            </button>
          </div>
        </div>

        {/* Milestone */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <Flag className="text-sm" />
            マイルストーン
          </label>
          {onUpdate ? (
            <select
              value={task.milestone_id || ''}
              onChange={(e) => handleMilestoneChange(e.target.value)}
              data-testid="task-inspector-milestone"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">未設定</option>
              {milestones.map((ms) => (
                <option key={ms.id} value={ms.id}>
                  {ms.name}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-700">
              {milestones.find((ms) => ms.id === task.milestone_id)?.name || '未設定'}
            </div>
          )}
        </div>

        {/* Assignee */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <User className="text-sm" />
            担当者
            {task.ball === 'client' && (
              <span className="text-[10px] text-amber-600 ml-1">
                (クライアントも選択可)
              </span>
            )}
            {/* 不整合状態警告: ball=internalでクライアント担当者（ロード中は非表示） */}
            {!membersLoading && task.ball === 'internal' && task.assignee_id && !internalMembers.some((m) => m.id === task.assignee_id) && (
              <span className="text-[10px] text-red-600 ml-1">
                ⚠ 社内メンバーに変更推奨
              </span>
            )}
          </label>
          {onUpdate ? (
            <select
              value={task.assignee_id || ''}
              onChange={(e) => handleAssigneeChange(e.target.value)}
              data-testid="task-inspector-assignee"
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white ${
                !membersLoading && task.ball === 'internal' && task.assignee_id && !internalMembers.some((m) => m.id === task.assignee_id)
                  ? 'border-red-300 bg-red-50'
                  : 'border-gray-200'
              }`}
            >
              <option value="">未設定</option>
              {assignableMembers.map((m) => {
                const isClientInInternalBall = task.ball === 'internal' && m.role === 'client'
                return (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.role === 'client' && ' (クライアント)'}
                    {isClientInInternalBall && m.id === task.assignee_id && ' ⚠'}
                  </option>
                )
              })}
            </select>
          ) : (
            <div className="text-sm text-gray-700">
              {task.assignee_id ? getMemberName(task.assignee_id) : '未設定'}
            </div>
          )}
        </div>

        {/* Owners (責任者) - FR-OWN-002: 設定で表示/非表示を切り替え */}
        {shouldShowOwnerField && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-500">責任者</label>
            {onUpdateOwners && !editingOwners && (
              <button
                onClick={handleStartEditingOwners}
                className="text-xs text-blue-600 hover:text-blue-700"
              >
                編集
              </button>
            )}
          </div>

          {editingOwners ? (
            <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
              {/* Client owners */}
              {clientMembers.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-amber-600">
                    クライアント担当
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {clientMembers.map((member) => {
                      const isSelected = selectedClientOwners.includes(member.id)
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleClientOwner(member.id)}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            isSelected
                              ? 'bg-amber-100 border-amber-300 text-amber-700 font-medium'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {member.displayName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Internal owners */}
              {internalMembers.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-500">
                    社内担当
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {internalMembers.map((member) => {
                      const isSelected = selectedInternalOwners.includes(member.id)
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleInternalOwner(member.id)}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            isSelected
                              ? 'bg-gray-200 border-gray-400 text-gray-700 font-medium'
                              : 'border-gray-200 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {member.displayName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setEditingOwners(false)}
                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 rounded"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleSaveOwners}
                  className="px-2 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {clientOwners.length > 0 && (
                <div>
                  <div className="text-xs text-amber-600 mb-1">クライアント</div>
                  <div className="flex flex-wrap gap-1">
                    {clientOwners.map((owner) => (
                      <span
                        key={owner.id}
                        className="px-2 py-0.5 text-xs bg-amber-50 text-amber-700 rounded"
                      >
                        {getMemberName(owner.user_id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {internalOwners.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">社内</div>
                  <div className="flex flex-wrap gap-1">
                    {internalOwners.map((owner) => (
                      <span
                        key={owner.id}
                        className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                      >
                        {getMemberName(owner.user_id)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {clientOwners.length === 0 && internalOwners.length === 0 && (
                <div className="text-sm text-gray-400">未設定</div>
              )}
            </div>
          )}
        </div>
        )}

        {/* Spec Task Info - AT-009: 2-click workflow */}
        {task.type === 'spec' && (
          <div className="space-y-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
            <label className="text-xs font-medium text-purple-600">
              仕様タスク
            </label>

            {/* Spec Path */}
            {task.spec_path ? (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <LinkIcon className="text-purple-400" />
                <a
                  href={task.spec_path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-600 hover:underline truncate"
                >
                  {task.spec_path}
                </a>
              </div>
            ) : (
              <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
                spec_path が設定されていません
              </div>
            )}

            {/* Decision State Badge */}
            {task.decision_state && (
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs px-2 py-1 rounded font-medium ${
                    task.decision_state === 'implemented'
                      ? 'bg-green-100 text-green-700'
                      : task.decision_state === 'decided'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {task.decision_state === 'implemented'
                    ? '実装済み'
                    : task.decision_state === 'decided'
                    ? '決定済み'
                    : '検討中'}
                </span>
              </div>
            )}

            {/* AT-009: 2-click workflow for decided → implemented */}
            {onSetSpecState && task.decision_state === 'decided' && (
              <div className="pt-2 space-y-2 border-t border-purple-200">
                {/* Step 1: Open spec to confirm */}
                {(!specConfirmClickTime || specConfirmTaskId !== task.id) && (
                  <button
                    onClick={() => {
                      if (task.spec_path) {
                        // Validate URL scheme for security (allow only http/https)
                        try {
                          const url = new URL(task.spec_path)
                          if (!['http:', 'https:'].includes(url.protocol)) {
                            alert('無効なURLスキームです')
                            return
                          }
                          window.open(task.spec_path, '_blank', 'noopener,noreferrer')
                          setSpecConfirmClickTime(Date.now())
                          setSpecConfirmTaskId(task.id)
                        } catch {
                          alert('無効なURLです')
                        }
                      }
                    }}
                    disabled={!task.spec_path}
                    data-testid="spec-confirm-open"
                    className={`w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                      task.spec_path
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    仕様を確認する
                  </button>
                )}

                {/* Step 2: Mark as implemented (within 10 minutes) */}
                {specConfirmClickTime && specConfirmTaskId === task.id && (
                  <>
                    <div className="text-xs text-purple-600">
                      仕様を確認しました。実装が完了したら下のボタンを押してください。
                      <br />
                      <span className="text-gray-500">
                        (10分以内に完了してください)
                      </span>
                    </div>
                    <button
                      onClick={async () => {
                        const elapsed = Date.now() - specConfirmClickTime
                        const tenMinutes = 10 * 60 * 1000
                        if (elapsed > tenMinutes) {
                          alert('10分を超えました。再度「仕様を確認する」を押してください。')
                          setSpecConfirmClickTime(null)
                          setSpecConfirmTaskId(null)
                          return
                        }
                        setIsSettingSpecState(true)
                        try {
                          await onSetSpecState('implemented')
                          setSpecConfirmClickTime(null)
                          setSpecConfirmTaskId(null)
                        } catch (err) {
                          alert(err instanceof Error ? err.message : '状態の更新に失敗しました')
                        } finally {
                          setIsSettingSpecState(false)
                        }
                      }}
                      disabled={isSettingSpecState}
                      data-testid="spec-mark-implemented"
                      className="w-full px-3 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSettingSpecState ? '処理中...' : '実装完了にする'}
                    </button>
                    <button
                      onClick={() => {
                        setSpecConfirmClickTime(null)
                        setSpecConfirmTaskId(null)
                      }}
                      className="w-full px-3 py-1 text-xs text-gray-500 hover:text-gray-700"
                    >
                      キャンセル
                    </button>
                  </>
                )}
              </div>
            )}

            {/* State transition for considering → decided */}
            {onSetSpecState && task.decision_state === 'considering' && (
              <div className="pt-2 border-t border-purple-200">
                <button
                  onClick={async () => {
                    if (!task.spec_path) {
                      alert('spec_path が設定されていません')
                      return
                    }
                    setIsSettingSpecState(true)
                    try {
                      await onSetSpecState('decided')
                    } catch (err) {
                      alert(err instanceof Error ? err.message : '状態の更新に失敗しました')
                    } finally {
                      setIsSettingSpecState(false)
                    }
                  }}
                  disabled={!task.spec_path || isSettingSpecState}
                  data-testid="spec-mark-decided"
                  className={`w-full px-3 py-2 text-sm rounded-lg transition-colors ${
                    task.spec_path && !isSettingSpecState
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isSettingSpecState ? '処理中...' : '決定済みにする'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Due Date */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">期限</label>
          {onUpdate ? (
            <div className="flex items-center gap-2">
              <Calendar className="text-gray-400" />
              <input
                type="date"
                value={task.due_date?.split('T')[0] || ''}
                onChange={(e) => handleDueDateChange(e.target.value)}
                data-testid="task-inspector-due-date"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ) : task.due_date ? (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Calendar className="text-gray-400" />
              <span>{new Date(task.due_date).toLocaleDateString('ja-JP')}</span>
            </div>
          ) : (
            <div className="text-sm text-gray-400">未設定</div>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">説明</label>
          {isEditingDescription ? (
            <div className="space-y-2">
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditDescription(task.description || '')
                    setIsEditingDescription(false)
                  }
                }}
                data-testid="task-inspector-description-input"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                rows={4}
                autoFocus
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setEditDescription(task.description || '')
                    setIsEditingDescription(false)
                  }}
                  className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleDescriptionSave}
                  className="px-2 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 rounded"
                >
                  保存
                </button>
              </div>
            </div>
          ) : onUpdate ? (
            <div
              onClick={() => setIsEditingDescription(true)}
              className="group cursor-pointer p-2 rounded border border-transparent hover:border-gray-200 hover:bg-gray-50 min-h-[60px]"
            >
              {task.description ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {task.description}
                </p>
              ) : (
                <p className="text-sm text-gray-400">クリックして説明を追加...</p>
              )}
            </div>
          ) : task.description ? (
            <p className="text-sm text-gray-700 whitespace-pre-wrap">
              {task.description}
            </p>
          ) : null}
        </div>

        {/* GitHub PRs */}
        <TaskPRList
          taskId={task.id}
          spaceId={spaceId}
          orgId={task.org_id}
          readOnly={!onUpdate}
        />

        {/* Comments */}
        <TaskComments
          orgId={task.org_id}
          spaceId={spaceId}
          taskId={task.id}
          currentUserId={currentUserId}
          clientOnly={false}
          canSetVisibility={isInternalMember}
        />
      </div>
    </div>
  )
}
