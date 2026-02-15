'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { X, ArrowRight, Circle, User, Calendar, Link as LinkIcon, Trash, PencilSimple, Check, Flag, Timer, TreeStructure } from '@phosphor-icons/react'
import { AmberBadge } from '@/components/shared'
import { createClient } from '@/lib/supabase/client'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useSpaceSettings } from '@/lib/hooks/useSpaceSettings'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { TaskComments } from './TaskComments'
import { TaskPRList } from '@/components/github'
import { SlackPostButton } from '@/components/slack'
import { TaskReviewSection } from '@/components/review'
import type { Task, TaskOwner, TaskStatus, Milestone, DecisionState } from '@/types/database'
import type { SupabaseClient } from '@supabase/supabase-js'

interface TaskInspectorProps {
  task: Task
  spaceId: string
  owners?: TaskOwner[]
  onClose: () => void
  onPassBall?: (ball: 'client' | 'internal', clientOwnerIds?: string[], internalOwnerIds?: string[]) => void
  onUpdate?: (updates: {
    title?: string
    description?: string | null
    status?: TaskStatus
    startDate?: string | null
    dueDate?: string | null
    milestoneId?: string | null
    assigneeId?: string | null
    parentTaskId?: string | null
    actualHours?: number | null
  }) => Promise<void>
  onDelete?: () => Promise<void>
  onUpdateOwners?: (clientOwnerIds: string[], internalOwnerIds: string[]) => Promise<void>
  /** AT-009: Spec task state transition */
  onSetSpecState?: (decisionState: DecisionState) => Promise<void>
  onReviewChange?: (taskId: string, status: string | null) => void
  /** Available parent tasks for parent selection */
  parentTasks?: { id: string; title: string }[]
  /** Child tasks of this task */
  childTasks?: Task[]
}

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: '未着手' },
  { value: 'todo', label: 'ToDo' },
  { value: 'in_progress', label: '進行中' },
  { value: 'in_review', label: '承認確認中' },
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
  onReviewChange,
  parentTasks = [],
  childTasks = [],
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

  // Reset spec confirmation state and pending ball change when task changes
  useEffect(() => {
    setSpecConfirmClickTime(null)
    setSpecConfirmTaskId(null)
    setIsSettingSpecState(false)
    setPendingBallChange(null)
    setOwnerValidationError(null)
    setEditingOwners(false)
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

  // Pending ball change state: when user clicks "外部" but no client owners exist yet
  const [pendingBallChange, setPendingBallChange] = useState<'client' | null>(null)
  const [ownerValidationError, setOwnerValidationError] = useState<string | null>(null)

  // Ref for auto-scroll to inline owner selector
  const pendingOwnerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to inline owner selector when pending state activates
  useEffect(() => {
    if (pendingBallChange && pendingOwnerRef.current) {
      pendingOwnerRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [pendingBallChange])

  const supabase = useMemo(() => createClient(), [])

  const clientOwners = owners.filter((o) => o.side === 'client')
  const internalOwners = owners.filter((o) => o.side === 'internal')

  // Fetch milestones
  useEffect(() => {
    const fetchMilestones = async () => {
       
      const { data: msData } = await (supabase as SupabaseClient)
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

  const handleStartDateChange = async (dateStr: string) => {
    const startDate = dateStr || null
    if (startDate !== task.start_date) {
      await onUpdate?.({ startDate })
    }
  }

  const handleDueDateChange = async (dateStr: string) => {
    const dueDate = dateStr || null
    if (dueDate !== task.due_date) {
      await onUpdate?.({ dueDate })
    }
  }

  const handleActualHoursChange = async (value: string) => {
    const hours = value === '' ? null : parseFloat(value)
    if (hours !== null && isNaN(hours)) return
    if (hours !== task.actual_hours) {
      await onUpdate?.({ actualHours: hours })
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

  // FR-ASN-003: ボール切り替え時のハンドラー（ペンディング状態対応）
  const handleBallChange = (newBall: 'client' | 'internal') => {
    if (newBall === 'client') {
      // 外部メンバーがスペースに存在しない場合
      if (clientMembers.length === 0) {
        setOwnerValidationError('スペースに外部メンバーが登録されていません。設定画面からメンバーを追加してください。')
        return
      }

      // 既に外部担当者が設定されている場合はそのまま渡す
      if (clientOwners.length > 0) {
        onPassBall?.(newBall)
        return
      }

      // 外部担当者が未設定 → ペンディング状態に移行して担当者選択UIを開く
      setPendingBallChange('client')
      setOwnerValidationError(null)
      setSelectedClientOwners([])
      setSelectedInternalOwners(internalOwners.map((o) => o.user_id))
      setEditingOwners(true)
      return
    }

    // 「社内」に切り替え: ペンディング状態をキャンセル
    if (pendingBallChange) {
      setPendingBallChange(null)
      setOwnerValidationError(null)
      setEditingOwners(false)
      return
    }

    // client → internal に切り替え時、担当者が社内メンバーでなければ警告
    if (task.ball === 'client' && task.assignee_id && !membersLoading) {
      const isInternalAssignee = internalMembers.some((m) => m.id === task.assignee_id)
      if (!isInternalAssignee) {
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
    if (pendingBallChange === 'client') {
      // ボール切替時: 外部担当者必須バリデーション
      if (selectedClientOwners.length === 0) {
        setOwnerValidationError('外部担当者を1人以上選択してください')
        return
      }
      // ボール切替 + オーナー更新を一括実行
      onPassBall?.('client', selectedClientOwners, selectedInternalOwners)
      setPendingBallChange(null)
      setOwnerValidationError(null)
      setEditingOwners(false)
      return
    }
    // 通常のオーナー更新
    await onUpdateOwners?.(selectedClientOwners, selectedInternalOwners)
    setEditingOwners(false)
  }

  const handleCancelPendingBall = () => {
    setPendingBallChange(null)
    setOwnerValidationError(null)
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
              <AmberBadge>確認待ち</AmberBadge>
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
                    ? 'text-blue-400'
                    : task.status === 'in_review'
                    ? 'text-amber-400'
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
                task.ball === 'internal' && !pendingBallChange
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
                task.ball === 'client' || pendingBallChange === 'client'
                  ? 'bg-amber-50 border-amber-300 font-medium text-amber-700'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              <span className="flex items-center justify-center gap-1">
                <ArrowRight weight="bold" className="text-xs" />
                外部
              </span>
            </button>
          </div>
          {/* インラインオーナー選択: ボールトグル直下に表示（空間的断絶を防ぐ） */}
          {pendingBallChange === 'client' && (
            <div ref={pendingOwnerRef} className="mt-2 p-3 bg-amber-50/60 rounded-lg border border-amber-200 space-y-3">
              {/* バリデーションエラー */}
              {ownerValidationError && (
                <p className="text-xs text-red-600 bg-red-50 px-2 py-1.5 rounded border border-red-200">
                  {ownerValidationError}
                </p>
              )}

              {/* 外部メンバーチップ */}
              <div>
                <label className="text-xs font-medium text-amber-700">
                  外部担当者を選択
                  <span className="text-[10px] ml-1 font-normal text-amber-500">(必須)</span>
                </label>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {clientMembers.map((member) => {
                    const isSelected = selectedClientOwners.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          toggleClientOwner(member.id)
                          setOwnerValidationError(null)
                        }}
                        className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                          isSelected
                            ? 'bg-amber-200 border-amber-400 text-amber-800 font-medium'
                            : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-50'
                        }`}
                      >
                        {member.displayName}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 社内メンバーチップ（折りたたみ気味に） */}
              {internalMembers.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-400">社内担当</label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {internalMembers.map((member) => {
                      const isSelected = selectedInternalOwners.includes(member.id)
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleInternalOwner(member.id)}
                          className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                            isSelected
                              ? 'bg-gray-200 border-gray-300 text-gray-700 font-medium'
                              : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
                          }`}
                        >
                          {member.displayName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* アクションボタン */}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={handleCancelPendingBall}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-white/60 rounded transition-colors"
                >
                  やめる
                </button>
                <button
                  onClick={handleSaveOwners}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded transition-colors"
                >
                  外部に渡す
                </button>
              </div>
            </div>
          )}

          {/* 外部メンバー不在エラー（クリックで消せる） */}
          {ownerValidationError && !pendingBallChange && (
            <button
              type="button"
              onClick={() => setOwnerValidationError(null)}
              className="w-full text-left"
            >
              <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg border border-red-200 flex items-center justify-between">
                <span>{ownerValidationError}</span>
                <X className="text-sm flex-shrink-0 text-red-400" />
              </p>
            </button>
          )}
        </div>

        {/* 承認フロー - ステータス/ボールの直後に配置 */}
        <TaskReviewSection
          taskId={task.id}
          spaceId={spaceId}
          orgId={task.org_id}
          taskStatus={task.status}
          readOnly={!onUpdate}
          onReviewChange={onReviewChange}
        />

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

        {/* Parent Task */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <TreeStructure className="text-sm" />
            親タスク
          </label>
          {onUpdate ? (
            <select
              value={task.parent_task_id || ''}
              onChange={(e) => onUpdate?.({ parentTaskId: e.target.value || null })}
              data-testid="task-inspector-parent"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">なし</option>
              {parentTasks.map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.title}
                </option>
              ))}
            </select>
          ) : (
            <div className="text-sm text-gray-700">
              {task.parent_task_id
                ? parentTasks.find((pt) => pt.id === task.parent_task_id)?.title || task.parent_task_id
                : 'なし'}
            </div>
          )}
        </div>

        {/* Child Tasks */}
        {childTasks.length > 0 && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <TreeStructure className="text-sm" />
              子タスク
              <span className="text-[10px] text-gray-400 ml-1">({childTasks.length}件)</span>
            </label>
            <div className="space-y-1">
              {childTasks.map((child) => (
                <div
                  key={child.id}
                  className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded text-sm"
                >
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor:
                        child.ball === 'client' ? '#F59E0B' : '#3B82F6',
                    }}
                  />
                  <span className={`flex-1 truncate ${child.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                    {child.title}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Assignee */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
            <User className="text-sm" />
            担当者
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
              {/* 社内メンバーグループ */}
              {internalMembers.length > 0 && (
                <optgroup label="社内メンバー">
                  {internalMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
              )}
              {/* 外部メンバーグループ (ball='client'時のみ表示) */}
              {(task.ball === 'client' || pendingBallChange === 'client') && clientMembers.length > 0 && (
                <optgroup label="外部メンバー">
                  {clientMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
                </optgroup>
              )}
              {/* 不整合状態: 現在の担当者がリストにない場合 */}
              {task.assignee_id && !internalMembers.some((m) => m.id === task.assignee_id) && !clientMembers.some((m) => m.id === task.assignee_id) && (() => {
                const currentAssignee = members.find((m) => m.id === task.assignee_id)
                return currentAssignee ? (
                  <option key={currentAssignee.id} value={currentAssignee.id}>
                    {currentAssignee.displayName} (不明)
                  </option>
                ) : null
              })()}
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
            <label className="text-xs font-medium text-gray-500">実行担当</label>
            {onUpdateOwners && !editingOwners && (
              <button
                onClick={handleStartEditingOwners}
                className="text-xs text-gray-500 hover:text-gray-700"
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
                    外部担当
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
                  <div className="text-xs text-amber-600 mb-1">外部</div>
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
          <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <label className="text-xs font-medium text-gray-500">
              仕様タスク
            </label>

            {/* Spec Path */}
            {task.spec_path ? (
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <LinkIcon className="text-gray-400" />
                <a
                  href={task.spec_path}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-600 hover:underline truncate"
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
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-100 text-gray-600'
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
              <div className="pt-2 space-y-2 border-t border-gray-200">
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
                        ? 'bg-gray-900 text-white hover:bg-gray-800'
                        : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    仕様を確認する
                  </button>
                )}

                {/* Step 2: Mark as implemented (within 10 minutes) */}
                {specConfirmClickTime && specConfirmTaskId === task.id && (
                  <>
                    <div className="text-xs text-gray-600">
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
              <div className="pt-2 border-t border-gray-200">
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
                      ? 'bg-gray-900 text-white hover:bg-gray-800'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  {isSettingSpecState ? '処理中...' : '決定済みにする'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Start Date */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">開始日</label>
          {onUpdate ? (
            <div className="flex items-center gap-2">
              <Calendar className="text-gray-400" />
              <input
                type="date"
                value={task.start_date?.split('T')[0] || ''}
                onChange={(e) => handleStartDateChange(e.target.value)}
                data-testid="task-inspector-start-date"
                className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ) : task.start_date ? (
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <Calendar className="text-gray-400" />
              <span>{new Date(task.start_date).toLocaleDateString('ja-JP')}</span>
            </div>
          ) : (
            <div className="text-sm text-gray-400">未設定</div>
          )}
        </div>

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

        {/* Actual Hours (shown when task is done) */}
        {task.status === 'done' && (
          <div className="space-y-2">
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <Timer className="text-sm" />
              実績工数
            </label>
            {onUpdate ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={task.actual_hours ?? ''}
                  onChange={(e) => handleActualHoursChange(e.target.value)}
                  placeholder="0.0"
                  data-testid="task-inspector-actual-hours"
                  className="w-24 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <span className="text-xs text-gray-500">時間</span>
              </div>
            ) : task.actual_hours !== null ? (
              <div className="text-sm text-gray-700">
                {task.actual_hours}h
              </div>
            ) : (
              <div className="text-sm text-gray-400">未入力</div>
            )}
          </div>
        )}

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

        {/* Slack */}
        <SlackPostButton taskId={task.id} spaceId={spaceId} />

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
