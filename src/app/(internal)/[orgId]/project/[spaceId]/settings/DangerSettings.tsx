'use client'

import { useState } from 'react'
import { Archive, ArrowCounterClockwise } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useSpaceArchive } from '@/lib/hooks/useSpaceArchive'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useSpaceName } from '@/lib/hooks/useSpaceName'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface DangerSettingsProps {
  spaceId: string
}

/**
 * 危険設定 — 取り返しのつきにくい操作だけを集めた場所。
 * 以前は「基本設定」の下に置いていたが、プロジェクト名を直すたびに目に入るのが嫌なので
 * 「データ管理」の中へ移した。メニュー側（settingsNav）でも管理者以外には出さない。
 */
export function DangerSettings({ spaceId }: DangerSettingsProps) {
  const [archiving, setArchiving] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  const [archiveConfirmText, setArchiveConfirmText] = useState('')

  const { isArchived, archive, unarchive } = useSpaceArchive(spaceId)
  const spaceName = useSpaceName(spaceId)
  const { members } = useSpaceMembers(spaceId)
  const { user } = useCurrentUser()
  const currentMember = members.find((m) => m.id === user?.id)
  const isAdmin = currentMember?.role === 'admin' || currentMember?.role === 'owner'

  return (
    <div>
      <h2 className="text-sm font-semibold text-red-600 mb-1">危険設定</h2>
      <p className="text-xs text-gray-500 mb-4">
        取り消しに手間がかかる操作です。実行する前に内容を確認してください。
      </p>

      {!isAdmin ? (
        <div className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-3">
          この操作はプロジェクトの管理者のみ可能です。
        </div>
      ) : isArchived ? (
        <div className="border border-red-100 rounded-lg p-4">
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-ink bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-50"
          >
            <ArrowCounterClockwise className="text-base" weight="bold" />
            {archiving ? '解除中...' : 'アーカイブを解除する'}
          </button>
        </div>
      ) : (
        <div className="border border-red-100 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-900 mb-1">プロジェクトをアーカイブする</h3>
          <p className="text-xs text-gray-500 mb-3">
            アーカイブすると、サイドバーの一覧から非表示になります。データは削除されず、いつでも復元できます。
          </p>
          {showArchiveConfirm ? (
            <div className="space-y-3 p-3 border border-red-200 rounded-lg bg-red-50/50">
              <p className="text-xs text-gray-700">
                確認のため、プロジェクト名 <span className="font-semibold text-red-600">{spaceName}</span> を入力してください。
              </p>
              <input
                type="text"
                value={archiveConfirmText}
                onChange={(e) => setArchiveConfirmText(e.target.value)}
                placeholder={spaceName}
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
                  disabled={archiving || !spaceName || archiveConfirmText !== spaceName}
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
    </div>
  )
}
