'use client'

import { useState, useEffect, useMemo } from 'react'
import { Pencil, Check, X, Archive, ArrowCounterClockwise } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useSpaceArchive } from '@/lib/hooks/useSpaceArchive'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

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
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [archiveConfirmText, setArchiveConfirmText] = useState('')
  const { isArchived, archive, unarchive } = useSpaceArchive(spaceId)
  const { members } = useSpaceMembers(spaceId)
  const { user } = useCurrentUser()
  const currentMember = members.find((m) => m.id === user?.id)
  const isAdmin = currentMember?.role === 'admin' || currentMember?.role === 'owner'

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    async function fetchSpace() {
       
      const { data, error } = await (supabase as SupabaseClient)
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

     
    const { error } = await (supabase as SupabaseClient)
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

      {/* 危険ゾーン (admin のみ表示) */}
      {isAdmin && <div className="mt-8 pt-6 border-t border-red-100">
        <h3 className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-3">
          危険ゾーン
        </h3>
        {isArchived ? (
          <div>
            <p className="text-xs text-gray-500 mb-3">
              このプロジェクトはアーカイブされています。解除するとサイドバーの一覧に再表示されます。
            </p>
            <button
              type="button"
              disabled={archiving}
              onClick={async () => {
                setArchiving(true)
                try {
                  await unarchive()
                  toast.success('アーカイブを解除しました')
                } catch {
                  toast.error('アーカイブ解除に失敗しました')
                } finally {
                  setArchiving(false)
                }
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
            >
              <ArrowCounterClockwise className="text-base" weight="bold" />
              {archiving ? '解除中...' : 'アーカイブを解除する'}
            </button>
          </div>
        ) : (
          <div>
            <p className="text-xs text-gray-500 mb-3">
              このプロジェクトをアーカイブすると、サイドバーの一覧から非表示になります。データは削除されず、いつでも復元できます。
            </p>
            {showArchiveConfirm ? (
              <div className="space-y-3 p-3 border border-red-200 rounded-lg bg-red-50/50">
                <p className="text-xs text-gray-700">
                  確認のため、プロジェクト名 <span className="font-semibold text-red-600">{originalName}</span> を入力してください。
                </p>
                <input
                  type="text"
                  value={archiveConfirmText}
                  onChange={(e) => setArchiveConfirmText(e.target.value)}
                  placeholder={originalName}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setShowArchiveConfirm(false)
                      setArchiveConfirmText('')
                    }
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={archiving || archiveConfirmText !== originalName}
                    onClick={async () => {
                      setArchiving(true)
                      try {
                        await archive()
                        setShowArchiveConfirm(false)
                        setArchiveConfirmText('')
                        toast.success('アーカイブしました', {
                          action: {
                            label: '元に戻す',
                            onClick: async () => {
                              try {
                                await unarchive()
                                toast.success('アーカイブを解除しました')
                              } catch {
                                toast.error('アーカイブ解除に失敗しました')
                              }
                            },
                          },
                        })
                      } catch {
                        toast.error('アーカイブに失敗しました')
                      } finally {
                        setArchiving(false)
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Archive className="text-base" weight="bold" />
                    {archiving ? 'アーカイブ中...' : 'アーカイブする'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowArchiveConfirm(false)
                      setArchiveConfirmText('')
                    }}
                    className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    キャンセル
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowArchiveConfirm(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
              >
                <Archive className="text-base" weight="bold" />
                アーカイブする
              </button>
            )}
          </div>
        )}
      </div>}
    </div>
  )
}
