'use client'

import { useState, useEffect, useMemo } from 'react'
import { Pencil, Check, X } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'

interface GeneralSettingsProps {
  spaceId: string
}

export function GeneralSettings({ spaceId }: GeneralSettingsProps) {
  const [name, setName] = useState('')
  const [originalName, setOriginalName] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function fetchSpace() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('spaces')
        .select('name')
        .eq('id', spaceId)
        .single()

      if (error) {
        setError('プロジェクト情報の取得に失敗しました')
      } else {
        setName(data.name)
        setOriginalName(data.name)
      }
      setLoading(false)
    }

    fetchSpace()
  }, [supabase, spaceId])

  const handleSave = async () => {
    if (!name.trim()) {
      setError('プロジェクト名を入力してください')
      return
    }

    setSaving(true)
    setError(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('spaces')
      .update({ name: name.trim() })
      .eq('id', spaceId)

    if (error) {
      setError('プロジェクト名の更新に失敗しました')
    } else {
      setOriginalName(name.trim())
      setIsEditing(false)
    }
    setSaving(false)
  }

  const handleCancel = () => {
    setName(originalName)
    setIsEditing(false)
    setError(null)
  }

  if (loading) {
    return (
      <div>
        <h2 className="text-sm font-semibold text-gray-900 mb-4">基本設定</h2>
        <div className="text-sm text-gray-400">読み込み中...</div>
      </div>
    )
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
                value={name}
                onChange={(e) => setName(e.target.value)}
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
              <span className="text-sm text-gray-900">{name}</span>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
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
