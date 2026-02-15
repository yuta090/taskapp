'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { X, Plus, Trash, Users, CalendarBlank } from '@phosphor-icons/react'
import { useSpaceMembers } from '@/lib/hooks/useSpaceMembers'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar/config'
import { FreeBusyOverlay } from './FreeBusyOverlay'
import { AvailableSlotsSuggest } from './AvailableSlotsSuggest'
import { useSpaceVideoProvider } from '@/lib/hooks/useSpaceVideoProvider'
import type { CreateProposalInput } from '@/lib/hooks/useSchedulingProposals'

type VideoProvider = 'google_meet' | 'zoom' | 'teams'

interface ProposalCreateSheetProps {
  orgId: string
  spaceId: string
  isOpen: boolean
  onClose: () => void
  onSubmit: (input: CreateProposalInput) => Promise<void>
}

const DURATION_OPTIONS = [
  { value: 15, label: '15分' },
  { value: 30, label: '30分' },
  { value: 60, label: '60分' },
  { value: 90, label: '90分' },
  { value: 120, label: '120分' },
]

const MIN_SLOTS = 2
const MAX_SLOTS = 5

interface SlotDraft {
  id: string
  startAt: string
}

export function ProposalCreateSheet({
  orgId,
  spaceId,
  isOpen,
  onClose,
  onSubmit,
}: ProposalCreateSheetProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [durationMinutes, setDurationMinutes] = useState(60)
  const [slots, setSlots] = useState<SlotDraft[]>(() =>
    Array.from({ length: 3 }, () => ({
      id: crypto.randomUUID(),
      startAt: '',
    }))
  )
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set())
  const [selectedInternalIds, setSelectedInternalIds] = useState<Set<string>>(new Set())
  const [expiresAt, setExpiresAt] = useState('')
  const [videoProvider, setVideoProvider] = useState<VideoProvider | ''>('')
  const [submitting, setSubmitting] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const titleRef = useRef<HTMLInputElement>(null)
  const prevIsOpenRef = useRef(false)

  const { clientMembers, internalMembers, loading: membersLoading } = useSpaceMembers(
    isOpen ? spaceId : null
  )

  // Video provider from space settings
  const { defaultProvider: spaceDefaultProvider, availableProviders } = useSpaceVideoProvider(
    isOpen ? spaceId : null
  )

  // Current user (for suggest available slots)
  const { user: currentUser } = useCurrentUser()

  // Google Calendar Free/Busy integration
  const isGCalEnabled = isGoogleCalendarConfigured()
  const { connections: integrationConnections } = useIntegrations(
    isGCalEnabled && isOpen ? orgId : ''
  )

  // 現在のユーザーがGoogleカレンダー接続済みか
  const isCurrentUserCalendarConnected = useMemo(() => {
    if (!currentUser || !isGCalEnabled) return false
    return integrationConnections.some(
      (c) => c.provider === 'google_calendar' && c.owner_id === currentUser.id && c.status === 'active'
    )
  }, [currentUser, isGCalEnabled, integrationConnections])

  // Build respondent list with calendar connection status for FreeBusyOverlay
  const freeBusyRespondents = useMemo(() => {
    const allSelected = [
      ...clientMembers.filter((m) => selectedClientIds.has(m.id)),
      ...internalMembers.filter((m) => selectedInternalIds.has(m.id)),
    ]

    return allSelected.map((member) => ({
      userId: member.id,
      displayName: member.displayName,
      isCalendarConnected: integrationConnections.some(
        (c) => c.provider === 'google_calendar' && c.owner_id === member.id && c.status === 'active'
      ),
    }))
  }, [clientMembers, internalMembers, selectedClientIds, selectedInternalIds, integrationConnections])

  // Reset form when opening
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      setTitle('')
      setDescription('')
      setDurationMinutes(60)
      setSlots(
        Array.from({ length: 3 }, () => ({
          id: crypto.randomUUID(),
          startAt: '',
        }))
      )
      setSelectedClientIds(new Set())
      setSelectedInternalIds(new Set())
      setExpiresAt('')
      setVideoProvider(spaceDefaultProvider || '')
      setSubmitting(false)
      setValidationError(null)
      setTimeout(() => titleRef.current?.focus(), 100)
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, spaceDefaultProvider])

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const addSlot = useCallback(() => {
    if (slots.length >= MAX_SLOTS) return
    setSlots((prev) => [...prev, { id: crypto.randomUUID(), startAt: '' }])
  }, [slots.length])

  const removeSlot = useCallback(
    (id: string) => {
      if (slots.length <= MIN_SLOTS) return
      setSlots((prev) => prev.filter((s) => s.id !== id))
    },
    [slots.length]
  )

  const updateSlot = useCallback((id: string, startAt: string) => {
    setSlots((prev) =>
      prev.map((s) => (s.id === id ? { ...s, startAt } : s))
    )
  }, [])

  // 空き時間候補が選択されたとき、スロットを置き換える
  const handleSuggestedSlotsSelected = useCallback(
    (suggested: { startAt: string }[]) => {
      const newSlots: SlotDraft[] = suggested.map((s) => ({
        id: crypto.randomUUID(),
        startAt: s.startAt,
      }))
      // 最低 MIN_SLOTS 個を維持
      while (newSlots.length < MIN_SLOTS) {
        newSlots.push({ id: crypto.randomUUID(), startAt: '' })
      }
      setSlots(newSlots)
    },
    [],
  )

  const toggleMember = useCallback(
    (userId: string, side: 'client' | 'internal') => {
      const setter = side === 'client' ? setSelectedClientIds : setSelectedInternalIds
      setter((prev) => {
        const next = new Set(prev)
        if (next.has(userId)) {
          next.delete(userId)
        } else {
          next.add(userId)
        }
        return next
      })
    },
    []
  )

  // Calculate end time from start + duration
  const calculateEndAt = useCallback(
    (startAt: string): string => {
      if (!startAt) return ''
      const start = new Date(startAt)
      if (isNaN(start.getTime())) return ''
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000)
      return end.toISOString()
    },
    [durationMinutes]
  )

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setValidationError(null)

      // Validation
      if (!title.trim()) {
        setValidationError('タイトルを入力してください')
        return
      }
      const validSlots = slots.filter((s) => s.startAt)
      if (validSlots.length < MIN_SLOTS) {
        setValidationError(`候補日を${MIN_SLOTS}個以上入力してください`)
        return
      }

      // Check all slots are in the future
      const now = new Date()
      for (const slot of validSlots) {
        if (new Date(slot.startAt) <= now) {
          setValidationError('候補日は未来の日時を指定してください')
          return
        }
      }

      setSubmitting(true)
      try {
        // Always include current user as internal respondent (creator = auto-participate)
        const internalRespondentIds = new Set(selectedInternalIds)
        if (currentUser) {
          internalRespondentIds.add(currentUser.id)
        }

        const input: CreateProposalInput = {
          title: title.trim(),
          description: description.trim() || undefined,
          durationMinutes,
          slots: validSlots.map((s) => ({
            startAt: new Date(s.startAt).toISOString(),
            endAt: calculateEndAt(s.startAt),
          })),
          respondents: [
            ...Array.from(selectedClientIds).map((userId) => ({
              userId,
              side: 'client' as const,
              isRequired: true,
            })),
            ...Array.from(internalRespondentIds).map((userId) => ({
              userId,
              side: 'internal' as const,
              isRequired: true,
            })),
          ],
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          videoProvider: videoProvider || undefined,
        }

        await onSubmit(input)
        onClose()
      } catch (err) {
        setValidationError(
          err instanceof Error ? err.message : '作成に失敗しました'
        )
      } finally {
        setSubmitting(false)
      }
    },
    [
      title,
      description,
      durationMinutes,
      slots,
      selectedClientIds,
      selectedInternalIds,
      currentUser,
      expiresAt,
      videoProvider,
      onSubmit,
      onClose,
      calculateEndAt,
    ]
  )

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        data-testid="proposal-create-backdrop"
      />

      {/* Sheet */}
      <div
        className="relative w-full max-w-lg bg-white rounded-xl shadow-xl max-h-[90vh] flex flex-col"
        data-testid="proposal-create-sheet"
      >
        {/* Header */}
        <div className="h-12 flex items-center justify-between px-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">新規日程調整</h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600"
            data-testid="proposal-create-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              タイトル <span className="text-red-400">*</span>
            </label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="デザインレビュー会議"
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              data-testid="proposal-create-title"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              説明（任意）
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="会議の目的や議題..."
              maxLength={1000}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
              data-testid="proposal-create-description"
            />
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              所要時間 <span className="text-red-400">*</span>
            </label>
            <select
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="proposal-create-duration"
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Slots */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">
              <CalendarBlank className="inline w-3.5 h-3.5 mr-1" />
              候補日時（{MIN_SLOTS}〜{MAX_SLOTS}個）
            </label>
            <div className="space-y-2">
              {slots.map((slot, idx) => (
                <div key={slot.id} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-8 flex-shrink-0">
                    候補{idx + 1}
                  </span>
                  <input
                    type="datetime-local"
                    value={slot.startAt}
                    onChange={(e) => updateSlot(slot.id, e.target.value)}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    data-testid={`slot-input-${idx}`}
                  />
                  {slots.length > MIN_SLOTS && (
                    <button
                      type="button"
                      onClick={() => removeSlot(slot.id)}
                      className="p-1 text-gray-400 hover:text-red-500"
                      data-testid={`slot-remove-${idx}`}
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 mt-2">
              {slots.length < MAX_SLOTS && (
                <button
                  type="button"
                  onClick={addSlot}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  data-testid="slot-add"
                >
                  <Plus className="w-3.5 h-3.5" />
                  候補を追加
                </button>
              )}
            </div>

            {/* 空き時間自動取得 */}
            {isGCalEnabled && currentUser && (
              <AvailableSlotsSuggest
                userId={currentUser.id}
                durationMinutes={durationMinutes}
                maxSlots={MAX_SLOTS}
                onSlotsSelected={handleSuggestedSlotsSelected}
                isCalendarConnected={isCurrentUserCalendarConnected}
              />
            )}

            {/* Free/Busy overlay - only shown when Google Calendar is enabled and respondents are selected */}
            {isGCalEnabled && freeBusyRespondents.length > 0 && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-2xs text-gray-400 mb-1.5">参加者の空き状況</p>
                <FreeBusyOverlay
                  respondents={freeBusyRespondents}
                  slots={slots}
                  durationMinutes={durationMinutes}
                />
              </div>
            )}
          </div>

          {/* Respondents: Client */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <label className="text-xs font-medium text-amber-700 flex items-center gap-1 mb-2">
              <Users className="w-3.5 h-3.5" />
              外部参加者
            </label>
            {membersLoading ? (
              <p className="text-xs text-gray-400">読み込み中...</p>
            ) : clientMembers.length === 0 ? (
              <p className="text-xs text-gray-400">外部メンバーがいません</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {clientMembers.map((member) => {
                  const isSelected = selectedClientIds.has(member.id)
                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => toggleMember(member.id, 'client')}
                      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                        isSelected
                          ? 'bg-amber-200 border-amber-400 text-amber-800 font-medium'
                          : 'bg-white border-amber-200 text-amber-600 hover:bg-amber-100'
                      }`}
                      data-testid={`proposal-create-client-${member.id}`}
                    >
                      {member.displayName}
                      {isSelected && ' ✓'}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Respondents: Internal */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1 mb-2">
              <Users className="w-3.5 h-3.5" />
              社内メンバー
            </label>
            {/* Creator is auto-included */}
            {currentUser && (
              <div className="flex items-center gap-1.5 mb-2">
                <span className="px-2.5 py-1 text-xs rounded-full bg-blue-100 border border-blue-300 text-blue-700 font-medium">
                  {internalMembers.find((m) => m.id === currentUser.id)?.displayName ?? 'あなた'}
                  <span className="text-blue-400 ml-1">（主催者・自動参加）</span>
                </span>
              </div>
            )}
            {membersLoading ? (
              <p className="text-xs text-gray-400">読み込み中...</p>
            ) : internalMembers.filter((m) => m.id !== currentUser?.id).length === 0 ? (
              <p className="text-xs text-gray-400">他の社内メンバーがいません</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {internalMembers
                  .filter((m) => m.id !== currentUser?.id)
                  .map((member) => {
                    const isSelected = selectedInternalIds.has(member.id)
                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => toggleMember(member.id, 'internal')}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                          isSelected
                            ? 'bg-gray-200 border-gray-400 text-gray-800 font-medium'
                            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                        data-testid={`proposal-create-internal-${member.id}`}
                      >
                        {member.displayName}
                        {isSelected && ' ✓'}
                      </button>
                    )
                  })}
              </div>
            )}
          </div>

          {/* Expires at */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              有効期限（任意）
            </label>
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              data-testid="proposal-create-expires"
            />
            {!expiresAt && (
              <p className="text-xs text-gray-400 mt-0.5">
                未設定の場合、期限なしになります
              </p>
            )}
          </div>

          {/* Video Conference Provider */}
          {availableProviders.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                ビデオ会議
              </label>
              <select
                value={videoProvider}
                onChange={(e) => setVideoProvider(e.target.value as VideoProvider | '')}
                className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                data-testid="proposal-create-video-provider"
              >
                <option value="">なし</option>
                {availableProviders.map((p) => (
                  <option key={p} value={p}>
                    {p === 'google_meet'
                      ? 'Google Meet'
                      : p === 'zoom'
                      ? 'Zoom'
                      : p === 'teams'
                      ? 'Microsoft Teams'
                      : p}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Validation error */}
          {validationError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {validationError}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              disabled={submitting}
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="proposal-create-submit"
            >
              {submitting ? '作成中...' : '提案を作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
