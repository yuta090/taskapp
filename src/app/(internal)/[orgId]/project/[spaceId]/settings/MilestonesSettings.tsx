'use client'

import { useState, useCallback } from 'react'
import { Flag, Plus, Trash, PencilSimple, Check, X, DotsSixVertical } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useConfirmDialog } from '@/components/shared'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'
import { useMilestones } from '@/lib/hooks/useMilestones'
import type { Milestone } from '@/types/database'

interface MilestonesSettingsProps {
  orgId: string
  spaceId: string
}

export function MilestonesSettings({ orgId, spaceId }: MilestonesSettingsProps) {
  const { confirm, ConfirmDialog } = useConfirmDialog()
  // マイルストーンの作成・編集・削除は milestones の RLS（app_can_write_space と同じ規則）。
  // 役割が未確定の間も canEdit は false（読み取り専用側に倒す）
  const { canEdit } = useCanEditSpace(spaceId, orgId)

  // タスク一覧・ガント・バーンダウン等と同じキャッシュ（['milestones', spaceId]）を共有する。
  // 以前は useState + useEffect の手書き取得で、開くたびに必ず「読み込み中」が出ていたが、
  // react-query の永続キャッシュ（IndexedDB）に前回分があればそれをすぐ表示できる。
  // 作成・更新・削除も useMilestones 側の楽観的更新（保存ボタン無しの方針どおり）にそろえる
  const { milestones, loading, error, createMilestone, updateMilestone, deleteMilestone } =
    useMilestones({ spaceId })

  // New milestone form
  const [newName, setNewName] = useState('')
  const [newStartDate, setNewStartDate] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [creating, setCreating] = useState(false)
  const [dateError, setDateError] = useState<string | null>(null)

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editStartDate, setEditStartDate] = useState('')
  const [editDueDate, setEditDueDate] = useState('')
  const [editDateError, setEditDateError] = useState<string | null>(null)

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    if (newStartDate && newDueDate && newStartDate > newDueDate) {
      setDateError('開始日は期限日より前に設定してください')
      return
    }
    setDateError(null)
    setCreating(true)
    try {
      await createMilestone({
        name: newName.trim(),
        startDate: newStartDate || null,
        dueDate: newDueDate || null,
      })
      setNewName('')
      setNewStartDate('')
      setNewDueDate('')
      toast.success('マイルストーンを作成しました')
    } catch (err) {
      console.error('Failed to create milestone:', err)
      toast.error('マイルストーンの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }, [newName, newStartDate, newDueDate, createMilestone])

  const handleDelete = useCallback(
    async (id: string) => {
      const ok = await confirm({
        title: 'マイルストーンを削除',
        message: 'このマイルストーンを削除しますか？',
        confirmLabel: '削除',
        variant: 'danger',
      })
      if (!ok) return
      try {
        await deleteMilestone(id)
        toast.success('マイルストーンを削除しました')
      } catch (err) {
        console.error('Failed to delete milestone:', err)
        toast.error('マイルストーンの削除に失敗しました')
      }
    },
    [confirm, deleteMilestone]
  )

  const startEdit = useCallback((ms: Milestone) => {
    setEditingId(ms.id)
    setEditName(ms.name)
    setEditStartDate(ms.start_date || '')
    setEditDueDate(ms.due_date || '')
    setEditDateError(null)
  }, [])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setEditName('')
    setEditStartDate('')
    setEditDueDate('')
    setEditDateError(null)
  }, [])

  const saveEdit = useCallback(async () => {
    if (!editingId || !editName.trim()) return
    if (editStartDate && editDueDate && editStartDate > editDueDate) {
      setEditDateError('開始日は期限日より前に設定してください')
      return
    }
    setEditDateError(null)
    try {
      await updateMilestone(editingId, {
        name: editName.trim(),
        startDate: editStartDate || null,
        dueDate: editDueDate || null,
      })
      cancelEdit()
      toast.success('マイルストーンを更新しました')
    } catch (err) {
      console.error('Failed to update milestone:', err)
      toast.error('マイルストーンの更新に失敗しました')
    }
  }, [editingId, editName, editStartDate, editDueDate, updateMilestone, cancelEdit])

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-500">
        読み込み中...
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        マイルストーンの取得に失敗しました: {error.message}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {ConfirmDialog}
      <div className="flex items-center gap-2 text-gray-700">
        <Flag className="text-lg" />
        <h3 className="font-medium">マイルストーン</h3>
      </div>

      {/* Milestone list */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {milestones.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-500 text-center">
            マイルストーンはまだありません
          </div>
        ) : (
          milestones.map((ms) => (
            <div
              key={ms.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50"
            >
              <DotsSixVertical className="text-gray-300 cursor-move" />

              {editingId === ms.id ? (
                // Edit mode
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                    <input
                      type="date"
                      value={editStartDate}
                      onChange={(e) => setEditStartDate(e.target.value)}
                      className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      title="開始日"
                    />
                    <input
                      type="date"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      title="期限"
                    />
                    <button
                      onClick={saveEdit}
                      className="p-1 text-green-600 hover:bg-green-50 rounded"
                    >
                      <Check className="text-sm" />
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="p-1 text-gray-500 hover:bg-gray-100 rounded"
                    >
                      <X className="text-sm" />
                    </button>
                  </div>
                  {editDateError && (
                    <div className="text-xs text-red-500 pl-1">{editDateError}</div>
                  )}
                </div>
              ) : (
                // View mode
                <>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {ms.name}
                      </span>
                      {ms.completed_at && (
                        <span className="text-[11px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded font-medium">
                          完了
                        </span>
                      )}
                    </div>
                    {(ms.start_date || ms.due_date) && (
                      <div className="text-xs text-gray-500">
                        {ms.start_date && ms.due_date
                          ? `${new Date(ms.start_date).toLocaleDateString('ja-JP')} 〜 ${new Date(ms.due_date).toLocaleDateString('ja-JP')}`
                          : ms.start_date
                            ? `開始: ${new Date(ms.start_date).toLocaleDateString('ja-JP')}`
                            : `期限: ${new Date(ms.due_date!).toLocaleDateString('ja-JP')}`
                        }
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => startEdit(ms)}
                    disabled={!canEdit}
                    aria-label={`${ms.name}を編集`}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <PencilSimple className="text-sm" />
                  </button>
                  <button
                    onClick={() => handleDelete(ms.id)}
                    disabled={!canEdit}
                    aria-label={`${ms.name}を削除`}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  >
                    <Trash className="text-sm" />
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add new milestone */}
      <div className="border border-gray-200 rounded-lg p-4">
        <div className="text-xs font-medium text-gray-500 mb-2">
          新規マイルストーン
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs text-gray-500">名前</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="マイルストーン名"
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="text-xs text-gray-500">開始日</label>
            <input
              type="date"
              value={newStartDate}
              onChange={(e) => { setNewStartDate(e.target.value); setDateError(null) }}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-40">
            <label className="text-xs text-gray-500">期限</label>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => { setNewDueDate(e.target.value); setDateError(null) }}
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || creating || !canEdit}
            className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Plus className="text-sm" />
            {creating ? '作成中...' : '追加'}
          </button>
        </div>
        {dateError && (
          <div className="text-xs text-red-500 mt-1">{dateError}</div>
        )}
      </div>
    </div>
  )
}
