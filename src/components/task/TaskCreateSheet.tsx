'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { X, ArrowRight, User, Calendar, Flag, Plus } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import type { TaskType, BallSide, DecisionState } from '@/types/database'

interface TaskCreateSheetProps {
  spaceId: string
  isOpen: boolean
  onClose: () => void
  onSubmit: (task: TaskCreateData) => void
  defaultBall?: BallSide
  defaultClientOwnerIds?: string[]
}

export interface TaskCreateData {
  title: string
  description?: string
  type: TaskType
  ball: BallSide
  origin: BallSide
  specPath?: string
  decisionState?: DecisionState
  clientOwnerIds: string[]
  internalOwnerIds: string[]
  dueDate?: string
  assigneeId?: string
  milestoneId?: string
}

export function TaskCreateSheet({
  spaceId,
  isOpen,
  onClose,
  onSubmit,
  defaultBall = 'internal',
  defaultClientOwnerIds = [],
}: TaskCreateSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<TaskType>('task')
  const [ball, setBall] = useState<BallSide>(defaultBall)
  const [specPath, setSpecPath] = useState('')
  const [decisionState, setDecisionState] = useState<DecisionState>('considering')
  const [clientOwnerIds, setClientOwnerIds] = useState<string[]>(defaultClientOwnerIds)
  const [internalOwnerIds, setInternalOwnerIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [milestoneId, setMilestoneId] = useState('')
  const [milestones, setMilestones] = useState<{ id: string; name: string }[]>([])
  const [showMilestonePopover, setShowMilestonePopover] = useState(false)
  const [newMilestoneName, setNewMilestoneName] = useState('')
  const [newMilestoneDue, setNewMilestoneDue] = useState('')
  const [milestoneCreating, setMilestoneCreating] = useState(false)

  // Use hook for members with display names
  const {
    members,
    clientMembers,
    internalMembers,
    loading: membersLoading,
    error: membersError,
  } = useSpaceMembers(isOpen ? spaceId : null)

  const inputRef = useRef<HTMLInputElement>(null)
  const milestonePopoverRef = useRef<HTMLDivElement>(null)
  const supabase = useMemo(() => createClient(), [])
  const prevIsOpenRef = useRef(false)

  // Focus input when opened and reset to defaults only when sheet opens
  useEffect(() => {
    // Only reset when sheet transitions from closed to open
    if (isOpen && !prevIsOpenRef.current) {
      inputRef.current?.focus()
      // Carry over previous client owners (UI Rules)
      setClientOwnerIds(defaultClientOwnerIds)
      setBall(defaultBall)
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, defaultBall, defaultClientOwnerIds])

  // Handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Fetch milestones only (members come from useSpaceMembers hook)
  useEffect(() => {
    if (!isOpen) return

    let active = true
    const fetchMilestones = async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const supabaseAny = supabase as any

        // Fetch milestones
        const { data: msData } = await supabaseAny
          .from('milestones')
          .select('id, name')
          .eq('space_id' as never, spaceId as never)
          .order('order_key' as never, { ascending: true })

        if (active) {
          setMilestones(msData || [])
        }
      } catch (err) {
        console.error('Failed to fetch milestones:', err)
      }
    }

    void fetchMilestones()

    return () => {
      active = false
    }
  }, [isOpen, spaceId, supabase])

  const toggleClientOwner = (ownerId: string) => {
    setClientOwnerIds((prev) =>
      prev.includes(ownerId)
        ? prev.filter((id) => id !== ownerId)
        : [...prev, ownerId]
    )
  }

  const toggleInternalOwner = (ownerId: string) => {
    setInternalOwnerIds((prev) =>
      prev.includes(ownerId)
        ? prev.filter((id) => id !== ownerId)
        : [...prev, ownerId]
    )
  }

  // Close milestone popover when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        showMilestonePopover &&
        milestonePopoverRef.current &&
        !milestonePopoverRef.current.contains(e.target as Node)
      ) {
        setShowMilestonePopover(false)
        setNewMilestoneName('')
        setNewMilestoneDue('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [showMilestonePopover])

  const handleCreateMilestone = async () => {
    if (!newMilestoneName.trim()) return
    setMilestoneCreating(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabaseAny = supabase as any
      const { data, error } = await supabaseAny
        .from('milestones')
        .insert({
          space_id: spaceId,
          name: newMilestoneName.trim(),
          due_date: newMilestoneDue || null,
          order_key: Date.now(),
        })
        .select('id, name')
        .single()

      if (error) throw error

      // Add to local list and select it
      setMilestones((prev) => [...prev, { id: data.id, name: data.name }])
      setMilestoneId(data.id)
      setShowMilestonePopover(false)
      setNewMilestoneName('')
      setNewMilestoneDue('')
    } catch (err) {
      console.error('Failed to create milestone:', err)
      alert('マイルストーンの作成に失敗しました')
    } finally {
      setMilestoneCreating(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    // Validate: spec tasks need spec_path
    if (type === 'spec' && !specPath) {
      alert('仕様タスクには spec_path が必要です')
      return
    }

    if (type === 'spec' && (!specPath.includes('/spec/') || !specPath.includes('#'))) {
      alert('仕様タスクの spec_path は /spec/...#... の形式で入力してください')
      return
    }

    // Validate: ball=client needs client owner
    if (ball === 'client' && clientOwnerIds.length === 0) {
      alert('クライアントにボールを渡す場合はクライアント担当者を指定してください')
      return
    }

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      type,
      ball,
      origin: 'internal', // Always internal when creating
      specPath: type === 'spec' ? specPath : undefined,
      decisionState: type === 'spec' ? decisionState : undefined,
      clientOwnerIds,
      internalOwnerIds,
      dueDate: dueDate || undefined,
      assigneeId: assigneeId || undefined,
      milestoneId: milestoneId || undefined,
    })

    // Reset form
    setTitle('')
    setDescription('')
    setType('task')
    setSpecPath('')
    setDueDate('')
    setAssigneeId('')
    setMilestoneId('')
    setInternalOwnerIds([])
    // Keep ball and clientOwnerIds for next creation
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        data-testid="task-create-sheet"
        className="relative w-full max-w-2xl bg-white rounded-xl shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-medium text-gray-900">新規タスク</h2>
          <button
            onClick={onClose}
            data-testid="task-create-close"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <X className="text-lg" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Title */}
          <div>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="タスクタイトルを入力..."
              data-testid="task-create-title"
              className="w-full px-3 py-2 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Type selector */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setType('task')}
              data-testid="task-create-type-task"
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                type === 'task'
                  ? 'bg-gray-100 border-gray-300 font-medium'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              通常タスク
            </button>
            <button
              type="button"
              onClick={() => setType('spec')}
              data-testid="task-create-type-spec"
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                type === 'spec'
                  ? 'bg-purple-100 border-purple-300 font-medium text-purple-700'
                  : 'border-gray-200 hover:bg-gray-50'
              }`}
            >
              仕様タスク
            </button>
          </div>

          {/* Spec fields */}
          {type === 'spec' && (
            <div className="space-y-3 p-3 bg-purple-50 rounded-lg">
              <div>
                <label className="text-xs font-medium text-purple-600">
                  仕様ファイルパス
                </label>
                <input
                  type="text"
                  value={specPath}
                  onChange={(e) => setSpecPath(e.target.value)}
                  placeholder="/spec/xxx.md#anchor"
                  data-testid="task-create-spec-path"
                  className="mt-1 w-full px-3 py-2 text-sm border border-purple-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-purple-600">
                  決定状態
                </label>
                <div className="mt-1 flex gap-2">
                  {(['considering', 'decided', 'implemented'] as const).map((state) => (
                    <button
                      key={state}
                      type="button"
                      onClick={() => setDecisionState(state)}
                      data-testid={`task-create-decision-${state}`}
                      className={`px-2 py-1 text-xs rounded border transition-colors ${
                        decisionState === state
                          ? 'bg-purple-100 border-purple-300 font-medium'
                          : 'border-purple-200 hover:bg-purple-50'
                      }`}
                    >
                      {state === 'considering'
                        ? '検討中'
                        : state === 'decided'
                        ? '決定'
                        : '実装済'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Due date, Assignee, Milestone row */}
          <div className="grid grid-cols-3 gap-3">
            {/* Due date */}
            <div>
              <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                <Calendar className="text-sm" />
                期限
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                data-testid="task-create-due-date"
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Assignee */}
            <div>
              <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                <User className="text-sm" />
                担当者
              </label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                data-testid="task-create-assignee"
                className="mt-1 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                disabled={membersLoading}
              >
                <option value="">{membersLoading ? '読み込み中...' : '未設定'}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>

            {/* Milestone */}
            <div className="relative">
              <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
                <Flag className="text-sm" />
                マイルストーン
              </label>
              <div className="mt-1 flex gap-1">
                <select
                  value={milestoneId}
                  onChange={(e) => setMilestoneId(e.target.value)}
                  data-testid="task-create-milestone"
                  className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">未設定</option>
                  {milestones.map((ms) => (
                    <option key={ms.id} value={ms.id}>
                      {ms.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowMilestonePopover(true)}
                  data-testid="task-create-milestone-add"
                  className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-500 hover:text-gray-700 transition-colors"
                  title="新規マイルストーンを作成"
                >
                  <Plus className="text-sm" weight="bold" />
                </button>
              </div>

              {/* Milestone creation popover */}
              {showMilestonePopover && (
                <div
                  ref={milestonePopoverRef}
                  className="absolute z-50 top-full mt-1 right-0 w-64 bg-white rounded-lg shadow-lg border border-gray-200 p-3"
                >
                  <div className="text-xs font-medium text-gray-700 mb-2">
                    新規マイルストーン
                  </div>
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={newMilestoneName}
                      onChange={(e) => setNewMilestoneName(e.target.value)}
                      placeholder="マイルストーン名"
                      data-testid="milestone-create-name"
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <input
                      type="date"
                      value={newMilestoneDue}
                      onChange={(e) => setNewMilestoneDue(e.target.value)}
                      data-testid="milestone-create-due"
                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowMilestonePopover(false)
                          setNewMilestoneName('')
                          setNewMilestoneDue('')
                        }}
                        className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      >
                        キャンセル
                      </button>
                      <button
                        type="button"
                        onClick={handleCreateMilestone}
                        disabled={!newMilestoneName.trim() || milestoneCreating}
                        data-testid="milestone-create-submit"
                        className="px-2 py-1 text-xs text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded transition-colors"
                      >
                        {milestoneCreating ? '作成中...' : '作成'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Ball selector */}
          <div>
            <label className="text-xs font-medium text-gray-500">ボール</label>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setBall('internal')}
                data-testid="task-create-ball-internal"
                className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                  ball === 'internal'
                    ? 'bg-gray-100 border-gray-300 font-medium'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                社内
              </button>
              <button
                type="button"
                onClick={() => setBall('client')}
                data-testid="task-create-ball-client"
                className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                  ball === 'client'
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

          {/* Client owners (required when ball=client) */}
          {ball === 'client' && (
            <div className="p-3 bg-amber-50 rounded-lg">
              <label className="text-xs font-medium text-amber-600">
                クライアント担当者（必須）
              </label>
              <div className="mt-2 flex items-center gap-2">
                <User className="text-amber-500" />
                <span className="text-sm text-amber-700">
                  {clientOwnerIds.length > 0
                    ? `${clientOwnerIds.length}名選択中`
                    : '担当者を選択してください'}
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {membersLoading && (
                  <div className="text-xs text-amber-600">読み込み中...</div>
                )}
                {membersError && (
                  <div className="text-xs text-amber-600">{membersError}</div>
                )}
                {!membersLoading && !membersError && clientMembers.length === 0 && (
                  <div className="text-xs text-amber-600">
                    クライアント担当者が見つかりません
                  </div>
                )}
                {!membersLoading && clientMembers.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {clientMembers.map((member) => {
                      const isSelected = clientOwnerIds.includes(member.id)
                      return (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => toggleClientOwner(member.id)}
                          data-testid={`task-create-client-owner-${member.id}`}
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            isSelected
                              ? 'bg-amber-100 border-amber-300 text-amber-700 font-medium'
                              : 'border-amber-200 text-amber-700 hover:bg-amber-100'
                          }`}
                          title={member.displayName}
                        >
                          {member.displayName}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Internal owners (optional, shown when ball=internal) */}
          {ball === 'internal' && internalMembers.length > 0 && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <label className="text-xs font-medium text-gray-600">
                社内担当者（任意）
              </label>
              <div className="mt-2 flex items-center gap-2">
                <User className="text-gray-500" />
                <span className="text-sm text-gray-700">
                  {internalOwnerIds.length > 0
                    ? `${internalOwnerIds.length}名選択中`
                    : '担当者を選択（任意）'}
                </span>
              </div>
              <div className="mt-3">
                <div className="flex flex-wrap gap-2">
                  {internalMembers.map((member) => {
                    const isSelected = internalOwnerIds.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleInternalOwner(member.id)}
                        data-testid={`task-create-internal-owner-${member.id}`}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          isSelected
                            ? 'bg-gray-200 border-gray-400 text-gray-700 font-medium'
                            : 'border-gray-300 text-gray-600 hover:bg-gray-100'
                        }`}
                        title={member.displayName}
                      >
                        {member.displayName}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="説明（任意）"
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="task-create-cancel"
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!title.trim()}
              data-testid="task-create-submit"
              className="px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              作成
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
