'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { CalendarBlank, Lightning, CaretDown, CaretUp, Check, Info } from '@phosphor-icons/react'
import {
  computeAvailableSlots,
  formatSlotLabel,
  dayLabel,
  type AvailableSlot,
  type BusyPeriod,
} from '@/lib/scheduling/computeAvailableSlots'

interface AvailableSlotsSuggestProps {
  /** 現在のユーザーID */
  userId: string
  /** ミーティング所要時間 */
  durationMinutes: number
  /** 最大選択可能スロット数 */
  maxSlots: number
  /** スロット選択時のコールバック */
  onSlotsSelected: (slots: { startAt: string }[]) => void
  /** Google Calendar 接続済みかどうか */
  isCalendarConnected: boolean
}

/** 日付文字列 "YYYY-MM-DD" を返す */
function toLocalDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 日付キーから表示用ヘッダを生成 "2/15(金)" */
function formatDateHeader(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00')
  const month = d.getMonth() + 1
  const day = d.getDate()
  const dow = dayLabel(d.getDay())
  return `${month}/${day}(${dow})`
}

export function AvailableSlotsSuggest({
  userId,
  durationMinutes,
  maxSlots,
  onSlotsSelected,
  isCalendarConnected,
}: AvailableSlotsSuggestProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null)
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([])
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(new Set())
  const [maxReachedHint, setMaxReachedHint] = useState(false)

  // デフォルト: 明日〜7日後
  const defaultRange = useMemo(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const weekLater = new Date()
    weekLater.setDate(weekLater.getDate() + 7)
    return {
      start: toLocalDateString(tomorrow),
      end: toLocalDateString(weekLater),
    }
  }, [])

  const [startDate, setStartDate] = useState(defaultRange.start)
  const [endDate, setEndDate] = useState(defaultRange.end)

  // durationMinutes が変わったら結果をクリア (R: 所要時間変更で古い結果が残る問題)
  useEffect(() => {
    if (availableSlots.length > 0) {
      setAvailableSlots([])
      setSelectedIdxs(new Set())
      setEmptyMessage(null)
    }
  }, [durationMinutes]) // eslint-disable-line react-hooks/exhaustive-deps

  // 日付バリデーション
  const dateError = useMemo(() => {
    if (!startDate || !endDate) return null
    if (startDate > endDate) return '開始日は終了日以前にしてください'
    // 30日以上の範囲は制限
    const diff = (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
    if (diff > 30) return '最大30日間まで指定できます'
    return null
  }, [startDate, endDate])

  const fetchAvailableSlots = useCallback(async () => {
    if (dateError) return

    setLoading(true)
    setError(null)
    setEmptyMessage(null)
    setAvailableSlots([])
    setSelectedIdxs(new Set())
    setMaxReachedHint(false)

    try {
      const startDt = new Date(startDate + 'T00:00:00')
      const endDt = new Date(endDate + 'T23:59:59')

      const res = await fetch('/api/integrations/freebusy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: [userId],
          timeMin: startDt.toISOString(),
          timeMax: endDt.toISOString(),
        }),
      })

      if (!res.ok) {
        throw new Error('カレンダー情報の取得に失敗しました')
      }

      const data = await res.json()
      const busyPeriods: BusyPeriod[] = data.calendars?.[userId]?.busy ?? []

      // 空きスロットを算出
      const slots = computeAvailableSlots(busyPeriods, {
        startDate,
        endDate,
        durationMinutes,
      })

      if (slots.length === 0) {
        setEmptyMessage('この期間に空き時間が見つかりませんでした')
      }

      setAvailableSlots(slots)
    } catch (err) {
      setError(err instanceof Error ? err.message : '取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [userId, startDate, endDate, durationMinutes, dateError])

  const toggleSlot = useCallback(
    (idx: number) => {
      setSelectedIdxs((prev) => {
        const next = new Set(prev)
        if (next.has(idx)) {
          next.delete(idx)
          setMaxReachedHint(false)
        } else {
          if (next.size >= maxSlots) {
            setMaxReachedHint(true)
            return prev
          }
          next.add(idx)
          setMaxReachedHint(false)
        }
        return next
      })
    },
    [maxSlots],
  )

  const handleApply = useCallback(() => {
    const selected = Array.from(selectedIdxs)
      .sort((a, b) => a - b)
      .map((idx) => ({ startAt: availableSlots[idx].startAt }))
    onSlotsSelected(selected)
    setIsExpanded(false)
    setAvailableSlots([])
    setSelectedIdxs(new Set())
    setEmptyMessage(null)
    setMaxReachedHint(false)
  }, [selectedIdxs, availableSlots, onSlotsSelected])

  // 日付グルーピング
  const groupedSlots = useMemo(() => {
    const groups: { dateKey: string; header: string; slots: { slot: AvailableSlot; idx: number }[] }[] = []
    let currentGroup: typeof groups[0] | null = null

    availableSlots.forEach((slot, idx) => {
      if (!currentGroup || currentGroup.dateKey !== slot.dateKey) {
        currentGroup = {
          dateKey: slot.dateKey,
          header: formatDateHeader(slot.dateKey),
          slots: [],
        }
        groups.push(currentGroup)
      }
      currentGroup.slots.push({ slot, idx })
    })

    return groups
  }, [availableSlots])

  if (!isCalendarConnected) return null

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 transition-colors cursor-pointer"
        data-testid="suggest-slots-toggle"
      >
        <Lightning className="w-3.5 h-3.5" />
        Googleカレンダーから空き時間を取得
        {isExpanded ? (
          <CaretUp className="w-3 h-3" />
        ) : (
          <CaretDown className="w-3 h-3" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
          {/* 説明テキスト */}
          <p className="text-[10px] text-gray-500">
            あなたのGoogleカレンダーの予定から、空いている時間帯を自動で検索します。
          </p>

          {/* 日付範囲選択 */}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-0.5">開始日</label>
              <input
                type="date"
                value={startDate}
                min={toLocalDateString(new Date())}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-blue-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                data-testid="suggest-start-date"
              />
            </div>
            <span className="text-xs text-gray-400 mt-4">〜</span>
            <div className="flex-1">
              <label className="block text-[10px] text-gray-500 mb-0.5">終了日</label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-blue-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                data-testid="suggest-end-date"
              />
            </div>
            <button
              type="button"
              onClick={fetchAvailableSlots}
              disabled={loading || !!dateError}
              className="mt-4 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              data-testid="suggest-fetch-btn"
            >
              {loading ? '取得中...' : '取得'}
            </button>
          </div>

          {/* 日付バリデーションエラー */}
          {dateError && (
            <p className="text-xs text-red-600">{dateError}</p>
          )}

          {/* API エラー */}
          {error && (
            <p className="text-xs text-red-600">{error}</p>
          )}

          {/* 空きなしメッセージ (エラーとは区別) */}
          {emptyMessage && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Info className="w-3.5 h-3.5 flex-shrink-0" />
              {emptyMessage}
            </div>
          )}

          {/* 結果リスト (日付グルーピング) */}
          {groupedSlots.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] text-gray-500">
                  空き枠 {availableSlots.length}件（最大{maxSlots}個選択）
                </p>
                {maxReachedHint && (
                  <p className="text-[10px] text-amber-600 font-medium">
                    最大{maxSlots}件まで選択可能です
                  </p>
                )}
              </div>
              <div className="max-h-56 overflow-y-auto space-y-2">
                {groupedSlots.map((group) => (
                  <div key={group.dateKey}>
                    <p className="text-[10px] font-medium text-gray-600 mb-0.5 sticky top-0 bg-blue-50 py-0.5">
                      {group.header}
                    </p>
                    <div className="space-y-0.5">
                      {group.slots.map(({ slot, idx }) => {
                        const isSelected = selectedIdxs.has(idx)
                        // 時刻のみ表示 (日付はヘッダで表示済み)
                        const s = new Date(slot.startAt)
                        const e = new Date(slot.endAt)
                        const timeLabel = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}〜${String(e.getHours()).padStart(2, '0')}:${String(e.getMinutes()).padStart(2, '0')}`
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => toggleSlot(idx)}
                            aria-pressed={isSelected}
                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border transition-colors text-left cursor-pointer ${
                              isSelected
                                ? 'bg-blue-100 border-blue-400 text-blue-800 font-medium'
                                : 'bg-white border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300'
                            }`}
                            data-testid={`suggest-slot-${idx}`}
                          >
                            <CalendarBlank className="w-3.5 h-3.5 flex-shrink-0 text-blue-500" />
                            <span className="flex-1">{timeLabel}</span>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 text-blue-600" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* 適用ボタン */}
              {selectedIdxs.size > 0 && (
                <button
                  type="button"
                  onClick={handleApply}
                  className="mt-2 w-full px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer"
                  data-testid="suggest-apply-btn"
                >
                  選択した{selectedIdxs.size}件を候補日に設定（既存の候補は置き換わります）
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
