'use client'

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Pencil, Check, X } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useSpaceName } from '@/lib/hooks/useSpaceName'
import { patchSpaceRow } from '@/lib/hooks/useSpaceRow'
import { useCanEditSpace } from '@/lib/hooks/useCanEditSpace'

interface GeneralSettingsProps {
  orgId: string
  spaceId: string
}

export function GeneralSettings({ orgId, spaceId }: GeneralSettingsProps) {
  // 名前の正本は ['space', spaceId]（プロジェクト1行）。パンくず・危険設定の確認入力も
  // 同じキャッシュを見ている。ここで独自に取り直すと、改名した直後に「古い名前」を
  // 要求する画面が出てしまう。
  const spaceName = useSpaceName(spaceId)
  const queryClient = useQueryClient()
  // プロジェクト名の更新は spaces の更新（RLS: app_can_write_space）と同じ規則。
  // 役割が未確定の間も canEdit は false（読み取り専用側に倒す）
  const { canEdit } = useCanEditSpace(spaceId, orgId)

  const [draft, setDraft] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  const handleEdit = () => {
    setDraft(spaceName)
    setError(null)
    setIsEditing(true)
  }

  const handleSave = async () => {
    const nextName = draft.trim()
    if (!nextName) {
      setError('プロジェクト名を入力してください')
      return
    }

    setSaving(true)
    setError(null)

    const { error } = await (supabase as SupabaseClient)
      .from('spaces')
      .update({ name: nextName })
      .eq('id', spaceId)

    if (error) {
      setError('プロジェクト名の更新に失敗しました')
    } else {
      // 同じ名前を見ている場所（パンくず・危険設定の確認入力・サイドバー）を即座に揃える
      patchSpaceRow(queryClient, spaceId, { name: nextName })
      void queryClient.invalidateQueries({ queryKey: ['userSpaces'] })
      setIsEditing(false)
    }
    setSaving(false)
  }

  const handleCancel = () => {
    setDraft(spaceName)
    setIsEditing(false)
    setError(null)
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-900 mb-4">基本設定</h2>

      <div className="space-y-4">
        {/* Project name */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            プロジェクト名
          </label>
          {isEditing ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="プロジェクト名"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSave()
                  if (e.key === 'Escape') handleCancel()
                }}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors disabled:opacity-50"
                title="保存"
              >
                <Check weight="bold" className="text-base" />
              </button>
              <button
                onClick={handleCancel}
                disabled={saving}
                className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                title="キャンセル"
              >
                <X weight="bold" className="text-base" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-900">
                {spaceName || <span className="text-gray-400">読み込み中...</span>}
              </span>
              <button
                onClick={handleEdit}
                disabled={!spaceName || !canEdit}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-40"
                title="編集"
              >
                <Pencil className="text-sm" />
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-500">{error}</div>
        )}
      </div>
    </div>
  )
}
