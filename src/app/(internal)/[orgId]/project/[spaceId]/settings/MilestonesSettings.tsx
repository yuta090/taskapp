'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Flag, Plus, Trash, PencilSimple, Check, X, DotsSixVertical } from '@phosphor-icons/react'
import type { SupabaseClient } from '@supabase/supabase-js'

interface Milestone {
  id: string
  name: string
  start_date: string | null
  due_date: string | null
  order_key: number
}

interface MilestonesSettingsProps {
  spaceId: string
}

export function MilestonesSettings({ spaceId }: MilestonesSettingsProps) {
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  const supabase = useMemo(() => createClient(), [])

  const fetchMilestones = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {

      const { data, error: pgErr } = await (supabase as SupabaseClient)
        .from('milestones')
        .select('id, name, start_date, due_date, order_key')
        .eq('space_id' as never, spaceId as never)
        .order('order_key' as never, { ascending: true })

      if (pgErr) {
        console.error('Milestone fetch error:', pgErr.message, `(code: ${pgErr.code})`)
        setError(`マイルストーンの取得に失敗しました: ${pgErr.message}`)
        return
      }
      setMilestones(data || [])
    } catch (err) {
      console.error('Failed to fetch milestones:', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(`マイルストーンの取得に失敗しました: ${msg}`)
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  useEffect(() => {
    void fetchMilestones()
  }, [fetchMilestones])

  const handleCreate = async () => {
    if (!newName.trim()) return
    if (newStartDate && newDueDate && newStartDate > newDueDate) {
      setDateError('開始日は期限日より前に設定してください')
      return
    }
    setDateError(null)
    setCreating(true)
    try {
       
      const { error: err } = await (supabase as SupabaseClient)
        .from('milestones')
        .insert({
          space_id: spaceId,
          name: newName.trim(),
          start_date: newStartDate || null,
          due_date: newDueDate || null,
          order_key: Date.now(),
        })

      if (err) throw err
      setNewName('')
      setNewStartDate('')
      setNewDueDate('')
      await fetchMilestones()
    } catch (err) {
      console.error('Failed to create milestone:', err)
      alert('マイルストーンの作成に失敗しました')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このマイルストーンを削除しますか？')) return
    try {
       
      const { error: err } = await (supabase as SupabaseClient)
        .from('milestones')
        .delete()
        .eq('id' as never, id as never)

      if (err) throw err
      await fetchMilestones()
    } catch (err) {
      console.error('Failed to delete milestone:', err)
      alert('マイルストーンの削除に失敗しました')
    }
  }

  const startEdit = (ms: Milestone) => {
    setEditingId(ms.id)
    setEditName(ms.name)
    setEditStartDate(ms.start_date || '')
    setEditDueDate(ms.due_date || '')
    setEditDateError(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditStartDate('')
    setEditDueDate('')
    setEditDateError(null)
  }

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return
    if (editStartDate && editDueDate && editStartDate > editDueDate) {
      setEditDateError('開始日は期限日より前に設定してください')
      return
    }
    setEditDateError(null)
    try {
       
      const { error: err } = await (supabase as SupabaseClient)
        .from('milestones')
        .update({
          name: editName.trim(),
          start_date: editStartDate || null,
          due_date: editDueDate || null,
        })
        .eq('id' as never, editingId as never)

      if (err) throw err
      cancelEdit()
      await fetchMilestones()
    } catch (err) {
      console.error('Failed to update milestone:', err)
      alert('マイルストーンの更新に失敗しました')
    }
  }

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
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
                    <div className="text-sm font-medium text-gray-900">
                      {ms.name}
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
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  >
                    <PencilSimple className="text-sm" />
                  </button>
                  <button
                    onClick={() => handleDelete(ms.id)}
                    className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
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
            disabled={!newName.trim() || creating}
            className="flex items-center gap-1 px-4 py-2 text-sm text-white bg-gray-900 hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
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
