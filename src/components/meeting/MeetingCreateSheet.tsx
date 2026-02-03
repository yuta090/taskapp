'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Calendar, Users, WarningCircle } from '@phosphor-icons/react'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { AmberBadge } from '@/components/shared'

interface MeetingCreateSheetProps {
  spaceId: string
  isOpen: boolean
  onClose: () => void
  onSubmit: (meeting: MeetingCreateData) => void
}

export interface MeetingCreateData {
  title: string
  heldAt?: string
  /** クライアント参加者のユーザーID（AT-001: 1名以上必須） */
  clientParticipantIds: string[]
  /** 社内参加者のユーザーID */
  internalParticipantIds: string[]
}

export function MeetingCreateSheet({
  spaceId,
  isOpen,
  onClose,
  onSubmit,
}: MeetingCreateSheetProps) {
  const [title, setTitle] = useState('')
  const [heldAt, setHeldAt] = useState('')
  const [clientParticipantIds, setClientParticipantIds] = useState<string[]>([])
  const [internalParticipantIds, setInternalParticipantIds] = useState<string[]>([])
  const [validationError, setValidationError] = useState<string | null>(null)

  const {
    clientMembers,
    internalMembers,
    loading: membersLoading,
    error: membersError,
  } = useSpaceMembers(isOpen ? spaceId : null)

  const inputRef = useRef<HTMLInputElement>(null)
  const prevIsOpenRef = useRef(false)

  // Focus input when opened and set default date
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      inputRef.current?.focus()
      // Set default date/time to now
      const now = new Date()
      const localDateTime = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16)
      setHeldAt(localDateTime)
      // Reset form
      setTitle(`新規会議 ${now.toLocaleDateString('ja-JP')}`)
      setClientParticipantIds([])
      setInternalParticipantIds([])
      setValidationError(null)
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen])

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

  const toggleClientParticipant = (userId: string) => {
    setClientParticipantIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
    setValidationError(null)
  }

  const toggleInternalParticipant = (userId: string) => {
    setInternalParticipantIds((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    )
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return

    // AT-001: クライアント参加者1名以上必須
    if (clientParticipantIds.length === 0) {
      setValidationError('クライアント参加者を1名以上選択してください')
      return
    }

    onSubmit({
      title: title.trim(),
      heldAt: heldAt ? new Date(heldAt).toISOString() : undefined,
      clientParticipantIds,
      internalParticipantIds,
    })

    onClose()
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
        data-testid="meeting-create-sheet"
        className="relative w-full max-w-lg bg-white rounded-xl shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-medium text-gray-900">新規会議</h2>
          <button
            onClick={onClose}
            data-testid="meeting-create-close"
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
            aria-label="閉じる"
          >
            <X className="text-lg" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Validation error */}
          {validationError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <WarningCircle className="text-red-500 flex-shrink-0" weight="fill" />
              <span className="text-sm text-red-700">{validationError}</span>
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-medium text-gray-500">会議タイトル</label>
            <input
              ref={inputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="会議タイトルを入力..."
              data-testid="meeting-create-title"
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Date/Time */}
          <div>
            <label className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <Calendar className="text-sm" />
              開催日時
            </label>
            <input
              type="datetime-local"
              value={heldAt}
              onChange={(e) => setHeldAt(e.target.value)}
              data-testid="meeting-create-held-at"
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Client participants (REQUIRED - AT-001) */}
          <div className={`p-3 rounded-lg border ${
            validationError && clientParticipantIds.length === 0
              ? 'bg-red-50 border-red-200'
              : 'bg-amber-50 border-amber-200'
          }`}>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-amber-700 flex items-center gap-1">
                <Users className="text-sm" />
                クライアント参加者
                <span className="text-red-500">*必須</span>
              </label>
              <AmberBadge>
                {clientParticipantIds.length}名選択
              </AmberBadge>
            </div>

            <div className="mt-3">
              {membersLoading && (
                <div className="text-xs text-amber-600">読み込み中...</div>
              )}
              {membersError && (
                <div className="text-xs text-red-600">{membersError}</div>
              )}
              {!membersLoading && !membersError && clientMembers.length === 0 && (
                <div className="text-xs text-amber-600">
                  クライアントメンバーが見つかりません。先にメンバーを招待してください。
                </div>
              )}
              {!membersLoading && clientMembers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {clientMembers.map((member) => {
                    const isSelected = clientParticipantIds.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleClientParticipant(member.id)}
                        data-testid={`meeting-create-client-${member.id}`}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-amber-200 border-amber-400 text-amber-800 font-medium'
                            : 'bg-white border-amber-300 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        {member.displayName}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Internal participants */}
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
                <Users className="text-sm" />
                社内参加者
              </label>
              <span className="text-xs text-gray-500">
                {internalParticipantIds.length}名選択
              </span>
            </div>

            <div className="mt-3">
              {!membersLoading && internalMembers.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {internalMembers.map((member) => {
                    const isSelected = internalParticipantIds.includes(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleInternalParticipant(member.id)}
                        data-testid={`meeting-create-internal-${member.id}`}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-gray-200 border-gray-400 text-gray-800 font-medium'
                            : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        {member.displayName}
                      </button>
                    )
                  })}
                </div>
              )}
              {!membersLoading && internalMembers.length === 0 && (
                <div className="text-xs text-gray-500">
                  社内メンバーが見つかりません
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              data-testid="meeting-create-cancel"
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={!title.trim() || membersLoading}
              data-testid="meeting-create-submit"
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
