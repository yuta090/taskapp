'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, Info, Notebook } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { MinutesEditorDynamic } from './MinutesEditorDynamic'
import { parseMinutesMarkdown, serializeMinutesBlocks } from '@/lib/minutes/markdown'
import { MinutesConflictError } from '@/lib/hooks/useMeetings'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { SAVING } from '@/lib/design/tokens'
import type { Meeting } from '@/types/database'

const AUTO_SAVE_DEBOUNCE_MS = 1500
const SAVED_BADGE_MS = 2000

const CONFLICT_MESSAGE =
  'この議事録は、開いたあとに別の場所（AI・コマンド・ほかの人）で更新されました。この画面で書いた内容はまだ保存されていません。'

export interface MinutesDocumentViewHandle {
  /**
   * 保留中の（デバウンス待ちの）保存があれば即座に流し、保存後の本文（Markdown）を返す。
   * 保留中の保存が無ければ何もせず、いまの本文をそのまま返す。タスク化の前に呼ぶ。
   */
  flushPendingSave: () => Promise<string>
}

interface MinutesDocumentViewProps {
  orgId: string
  spaceId: string
  meeting: Meeting
  /** この space を編集できるか。会議の status では決めない（予定の会議でも書ける） */
  canEdit: boolean
  onBack: () => void
  /** モバイルの情報ボタン。押すと親が会議詳細（Inspector）をシートで開く */
  onOpenInfo: () => void
  updateMinutes: (meetingId: string, minutesMd: string, baseUpdatedAt: string) => Promise<string>
  fetchMeetingDetail: (meetingId: string) => Promise<Meeting | null>
}

type SaveState = 'idle' | 'saving' | 'saved'

export const MinutesDocumentView = forwardRef<MinutesDocumentViewHandle, MinutesDocumentViewProps>(
  function MinutesDocumentView(
    { orgId, spaceId, meeting, canEdit, onBack, onOpenInfo, updateMinutes, fetchMeetingDetail },
    ref
  ) {
    const detailLoaded = meeting.minutes_md !== undefined

    // エディタを作り直すための種。meeting.id が変わったとき・「最新を読み込む」で
    // 作り直す。key に含めて MinutesEditorDynamic を丸ごと再マウントする。
    const [seed, setSeed] = useState(() => ({
      key: meeting.id,
      minutesMd: meeting.minutes_md ?? '',
      updatedAt: meeting.updated_at,
    }))

    const [saveState, setSaveState] = useState<SaveState>('idle')
    const [isEmpty, setIsEmpty] = useState(false)
    const [conflict, setConflict] = useState(false)
    const [loadingLatest, setLoadingLatest] = useState(false)

    // 読み込んだ本文を正規化した値。onChange がこれと同じ内容で呼ばれても保存しない
    // （BlockNote が初期表示直後に normalize 済みの内容で onChange を呼ぶ場合の歯止め）
    const baselineRef = useRef(serializeMinutesBlocks(parseMinutesMarkdown(seed.minutesMd)))
    const baseUpdatedAtRef = useRef(seed.updatedAt)
    const currentContentRef = useRef(baselineRef.current)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const conflictRef = useRef(false)

    // 会議を切り替えたら（別の会議 or 「最新を読み込む」）基準を作り直す
    useEffect(() => {
      baselineRef.current = serializeMinutesBlocks(parseMinutesMarkdown(seed.minutesMd))
      baseUpdatedAtRef.current = seed.updatedAt
      currentContentRef.current = baselineRef.current
      setSaveState('idle')
      setIsEmpty(false)
      setConflict(false)
      conflictRef.current = false
    }, [seed])

    // 会議が切り替わったら（一覧から別の会議を開いた）種を作り直す
    const prevMeetingIdRef = useRef(meeting.id)
    useEffect(() => {
      if (prevMeetingIdRef.current === meeting.id) return
      prevMeetingIdRef.current = meeting.id
      setSeed({ key: meeting.id, minutesMd: meeting.minutes_md ?? '', updatedAt: meeting.updated_at })
    }, [meeting.id, meeting.minutes_md, meeting.updated_at])

    useEffect(() => {
      return () => {
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
        if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
      }
    }, [])

    const performSave = useCallback(
      async (content: string) => {
        setSaveState('saving')
        try {
          const newUpdatedAt = await updateMinutes(meeting.id, content, baseUpdatedAtRef.current)
          baseUpdatedAtRef.current = newUpdatedAt
          baselineRef.current = content
          setSaveState('saved')
          if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
          savedBadgeTimerRef.current = setTimeout(() => setSaveState('idle'), SAVED_BADGE_MS)
        } catch (err) {
          setSaveState('idle')
          if (err instanceof MinutesConflictError) {
            conflictRef.current = true
            setConflict(true)
          } else {
            toast.error('議事録を保存できませんでした')
          }
        }
      },
      [meeting.id, updateMinutes]
    )

    const handleEditorChange = useCallback(
      (content: string) => {
        currentContentRef.current = content

        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }

        // 開いたときと同じ内容（正規化済み比較）なら保存しない。BlockNote が初期表示
        // 直後に normalize 済みの内容で onChange を呼んできても、ここで吸収する。
        if (content === baselineRef.current) {
          setIsEmpty(false)
          return
        }

        if (content.trim() === '') {
          setIsEmpty(true)
          return
        }
        setIsEmpty(false)

        if (conflictRef.current) return

        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null
          void performSave(content)
        }, AUTO_SAVE_DEBOUNCE_MS)
      },
      [performSave]
    )

    const handleCopyDraft = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(currentContentRef.current)
        toast.success('書きかけをコピーしました')
      } catch {
        toast.error('コピーできませんでした')
      }
    }, [])

    const handleLoadLatest = useCallback(async () => {
      setLoadingLatest(true)
      try {
        const fresh = await fetchMeetingDetail(meeting.id)
        if (fresh) {
          setSeed({
            key: `${meeting.id}-${Date.now()}`,
            minutesMd: fresh.minutes_md ?? '',
            updatedAt: fresh.updated_at,
          })
        }
      } catch {
        toast.error('最新の議事録を読み込めませんでした')
      } finally {
        setLoadingLatest(false)
      }
    }, [fetchMeetingDetail, meeting.id])

    useImperativeHandle(
      ref,
      () => ({
        flushPendingSave: async () => {
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
            if (!conflictRef.current) {
              await performSave(currentContentRef.current)
            }
          }
          return currentContentRef.current
        },
      }),
      [performSave]
    )

    const heldAtLabel = meeting.held_at ? new Date(meeting.held_at).toLocaleString('ja-JP') : '未設定'

    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-surface flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onBack}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
              aria-label="会議一覧へ戻る"
            >
              <ArrowLeft className="text-lg" />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-gray-900 truncate">{meeting.title}</h1>
              <p className="text-xs text-gray-400">{heldAtLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {saveState === 'saving' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 ${SAVING.dot} rounded-full animate-pulse`} />
                保存中...
              </span>
            )}
            {saveState === 'saved' && <span className="text-xs text-green-500">保存済み</span>}
            <button
              type="button"
              onClick={onOpenInfo}
              className="md:hidden p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              aria-label="会議情報"
            >
              <Info className="text-lg" />
            </button>
            <div data-header-bell className="hidden md:block -my-1">
              <AnnouncementBell />
            </div>
          </div>
        </div>

        {conflict && (
          <div className="px-6 py-3 bg-orange-50 border-b border-orange-200 flex-shrink-0">
            <p className="text-sm text-orange-700">{CONFLICT_MESSAGE}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopyDraft}
                className="text-xs font-medium text-orange-700 hover:text-orange-900 underline"
              >
                書きかけをコピー
              </button>
              <button
                type="button"
                onClick={handleLoadLatest}
                disabled={loadingLatest}
                className="text-xs font-medium text-orange-700 hover:text-orange-900 underline disabled:opacity-50"
              >
                最新を読み込む
              </button>
            </div>
          </div>
        )}

        {isEmpty && !conflict && (
          <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
            <p className="text-xs text-gray-500">本文が空です。保存されていません</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-4">
            {!detailLoaded ? (
              <div className="flex items-center justify-center py-16">
                <span className="text-sm text-gray-400">読み込み中...</span>
              </div>
            ) : (
              <>
                {!seed.minutesMd && (
                  <div className="mb-4 flex items-start gap-2 text-sm text-gray-400">
                    <Notebook className="text-base mt-0.5 flex-shrink-0" />
                    <p>
                      ここに議事録を書きます。会議の前に、決めることや進め方を書いておくこともできます。
                    </p>
                  </div>
                )}
                <MinutesEditorDynamic
                  key={seed.key}
                  minutesMd={seed.minutesMd}
                  onChange={handleEditorChange}
                  editable={canEdit}
                  orgId={orgId}
                  spaceId={spaceId}
                />
              </>
            )}
          </div>
        </div>
      </div>
    )
  }
)
