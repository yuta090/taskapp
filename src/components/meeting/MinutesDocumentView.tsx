'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowLeft, Info, Notebook } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { MinutesEditorDynamic } from './MinutesEditorDynamic'
import { parseMinutesMarkdown, serializeMinutesBlocks } from '@/lib/minutes/markdown'
import { MinutesConflictError } from '@/lib/hooks/useMeetings'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { ErrorRetry } from '@/components/shared'
import { SAVING } from '@/lib/design/tokens'
import type { Meeting } from '@/types/database'

const AUTO_SAVE_DEBOUNCE_MS = 1500
const SAVED_BADGE_MS = 2000

const CONFLICT_MESSAGE =
  'AI秘書やほかの人が、この議事録を先に書き換えました。あなたが書いた分はまだ保存されていません。' +
  '「書きかけをコピー」で控えてから「最新を読み込む」を押してください（読み込むと、この画面の書きかけは消えます）。'

interface UpdateMinutesResult {
  minutesMd: string | null
  updatedAt: string
}

export interface MinutesDocumentViewHandle {
  /**
   * 保留中の（デバウンス待ちの）保存があれば即座に流し、保存が確定した本文（Markdown）を返す。
   * 保留中の保存が無ければ、何もせず今の（確定済みの）本文をそのまま返す。
   * 競合中・保存に失敗した・別の保存が通信中（同時に2本流さない）のいずれかなら、
   * 本文は返さず例外を投げる（タスク化の前に呼ぶため、確定していない本文を渡さないようにする）。
   */
  flushPendingSave: () => Promise<string>
  /** 今わかっている保存の基準(updated_at)。詳細をまだ読み込めていなければ null */
  getBaseUpdatedAt: () => string | null
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
  updateMinutes: (meetingId: string, minutesMd: string, baseUpdatedAt: string) => Promise<UpdateMinutesResult>
  fetchMeetingDetail: (meetingId: string) => Promise<Meeting | null>
}

/** BlockNote が末尾に足す空段落・余分な空行を、比べる前・保存する前の両方で落とす */
function trimTrailingBlank(md: string): string {
  return md.replace(/\s+$/, '')
}

interface Baseline {
  /** 正規化(parse→serialize)済みの本文。onChange の「開いたときと同じ内容」比較に使う */
  normalized: string
  /** parseMinutesMarkdown/serializeMinutesBlocks が例外を出したか。出たら読み取り専用に倒す */
  broken: boolean
}

/** 例外が出ないはずのところへの念のための守り。変換が失敗しても画面を壊さず読み取り専用にする */
function computeBaseline(minutesMd: string): Baseline {
  try {
    return { normalized: trimTrailingBlank(serializeMinutesBlocks(parseMinutesMarkdown(minutesMd))), broken: false }
  } catch {
    return { normalized: trimTrailingBlank(minutesMd), broken: true }
  }
}

// =====================================================================================
// 内側: 種・基準・タイマーを持つ本体。開いたときに取り直した詳細（本文と updated_at が
// 同じ行のもの）が届いてから初めてマウントする（外側が phase==='loaded' のときだけ描く）。
// 一度マウントしたら、以後は自分の中の状態（Wiki の WikiPageClient.tsx 222〜250行と同じ
// 考え方）が正本になり、外側の meeting プロパティの変化（一覧キャッシュの取り直し等）では
// 作り直さない。作り直すのは外側が key を変えたとき（会議の切り替え・最新を読み込む・
// タスク化後の取り直し）だけ。
// =====================================================================================

interface MinutesDocumentBodyHandle {
  flushPendingSave: () => Promise<string>
  getBaseUpdatedAt: () => string
}

interface MinutesDocumentBodyProps {
  orgId: string
  spaceId: string
  meetingId: string
  canEdit: boolean
  /** 開いたときに取り直した詳細の本文。マウント時にだけ使う（以後の変化は見ない） */
  initialMinutesMd: string
  /** 同じ詳細取得で届いた updated_at。保存の基準にする */
  initialUpdatedAt: string
  updateMinutes: MinutesDocumentViewProps['updateMinutes']
  fetchMeetingDetail: MinutesDocumentViewProps['fetchMeetingDetail']
  onSaveStateChange: (state: 'idle' | 'saving' | 'saved') => void
  /** 「最新を読み込む」。外側に取り直しを頼み、外側が key を変えて作り直す */
  onRequestReload: () => void
}

const MinutesDocumentBody = forwardRef<MinutesDocumentBodyHandle, MinutesDocumentBodyProps>(
  function MinutesDocumentBody(
    {
      orgId,
      spaceId,
      meetingId,
      canEdit,
      initialMinutesMd,
      initialUpdatedAt,
      updateMinutes,
      fetchMeetingDetail,
      onSaveStateChange,
      onRequestReload,
    },
    ref
  ) {
    // 基準の計算は最初の1回だけ（毎レンダーで parse/serialize を走らせない）。
    // このコンポーネント自体が「開いたときに取り直した詳細」ごとに作り直される
    // （呼び出し側が key を変える）ため、以後 initialMinutesMd が変わっても計算し直さない。
    const [initialBaseline] = useState(() => computeBaseline(initialMinutesMd))

    const [isEmpty, setIsEmpty] = useState(false)
    const [conflict, setConflict] = useState(false)

    const parseBrokenRef = useRef(initialBaseline.broken)
    // 読み込んだ本文を正規化した値。onChange がこれと同じ内容で呼ばれても保存しない
    const baselineRef = useRef(initialBaseline.normalized)
    const baseUpdatedAtRef = useRef(initialUpdatedAt)
    // 「サーバーにあると分かっている生の本文」。開いたときは取り直した minutes_md、
    // 保存の後は更新結果の minutes_md。開始/終了などで updated_at だけが進んだ見せかけの
    // 競合と、本当に本文が変わった競合を区別するために使う（HIGH-2）。
    const knownServerRawRef = useRef(initialMinutesMd)
    const currentContentRef = useRef(initialBaseline.normalized)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const conflictRef = useRef(false)
    // 保存は同時に1本だけ。通信中に来た本文は最後の1つだけ残し、今の保存が終わってから送る
    const savingRef = useRef(false)
    const pendingContentRef = useRef<string | null>(null)
    const lastSaveFailedRef = useRef(false)
    const saveChainRef = useRef<Promise<void> | null>(null)

    const onSaveStateChangeRef = useRef(onSaveStateChange)
    onSaveStateChangeRef.current = onSaveStateChange

    const setSaveState = useCallback((state: 'idle' | 'saving' | 'saved') => {
      onSaveStateChangeRef.current(state)
    }, [])

    // 実際に DB へ書きに行く1回ぶん。呼び出し元(scheduleSave)が「同時に1本だけ」を保証する。
    const runSave = useCallback(
      async (content: string): Promise<void> => {
        savingRef.current = true
        lastSaveFailedRef.current = false
        setSaveState('saving')

        let base = baseUpdatedAtRef.current
        let attempted0Row = false
        for (;;) {
          try {
            const result = await updateMinutes(meetingId, content, base)
            baseUpdatedAtRef.current = result.updatedAt
            knownServerRawRef.current = result.minutesMd ?? ''
            baselineRef.current = content
            setSaveState('saved')
            if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
            savedBadgeTimerRef.current = setTimeout(() => setSaveState('idle'), SAVED_BADGE_MS)
            break
          } catch (err) {
            if (err instanceof MinutesConflictError && !attempted0Row) {
              attempted0Row = true
              // 0行だった。開始/終了など本文以外の更新で updated_at だけが進んだ見せかけの
              // 競合かもしれないので、本文とupdated_atを読み直して確かめる。
              let fresh: Meeting | null = null
              try {
                fresh = await fetchMeetingDetail(meetingId)
              } catch {
                fresh = null
              }
              const freshRaw = fresh?.minutes_md ?? ''
              if (fresh && freshRaw === knownServerRawRef.current) {
                // 本文は変わっていない → 基準だけ差し替えて1回だけ送り直す
                base = fresh.updated_at
                continue
              }
              // 本文が違う（本当の競合） or 読み直しにも失敗 → 競合として止める
              conflictRef.current = true
              setConflict(true)
              lastSaveFailedRef.current = true
              setSaveState('idle')
              break
            }
            if (err instanceof MinutesConflictError) {
              conflictRef.current = true
              setConflict(true)
            } else {
              toast.error('議事録を保存できませんでした')
            }
            lastSaveFailedRef.current = true
            setSaveState('idle')
            break
          }
        }

        savingRef.current = false
        if (pendingContentRef.current !== null) {
          const next = pendingContentRef.current
          pendingContentRef.current = null
          if (!conflictRef.current) {
            const chain = runSave(next)
            saveChainRef.current = chain
            await chain
            return
          }
        }
      },
      [meetingId, updateMinutes, fetchMeetingDetail, setSaveState]
    )

    /** 保存を1本にまとめて流す。既に通信中なら、最後の1つだけキューに乗せて今の保存を待つ */
    const scheduleSave = useCallback(
      (content: string): Promise<void> => {
        if (savingRef.current) {
          pendingContentRef.current = content
          return saveChainRef.current ?? Promise.resolve()
        }
        const chain = runSave(content)
        saveChainRef.current = chain
        return chain
      },
      [runSave]
    )

    const handleEditorChange = useCallback(
      (content: string) => {
        if (!canEdit || parseBrokenRef.current) return

        const trimmed = trimTrailingBlank(content)
        currentContentRef.current = trimmed

        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }

        // 開いたときと同じ内容（正規化済み比較）なら保存しない。BlockNote が初期表示
        // 直後に normalize 済みの内容で onChange を呼んできても、ここで吸収する。
        if (trimmed === baselineRef.current) {
          setIsEmpty(false)
          return
        }

        if (trimmed.trim() === '') {
          setIsEmpty(true)
          return
        }
        setIsEmpty(false)

        if (conflictRef.current) return

        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null
          void scheduleSave(trimmed)
        }, AUTO_SAVE_DEBOUNCE_MS)
      },
      [canEdit, scheduleSave]
    )

    const handleCopyDraft = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(currentContentRef.current)
        toast.success('書きかけをコピーしました')
      } catch {
        toast.error('コピーできませんでした')
      }
    }, [])

    // アンマウント時（「戻る」を待たずに離れた等）は、保留中の本文を state を触らずに送る。
    // 通信の結果を待てない（コンポーネントは既に無い）ため、成否は問わないベストエフォート。
    useEffect(() => {
      return () => {
        if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
          // parseBrokenRef.current はマウント時に1回だけ決まり、以後変わらない（読み取り専用に
          // 倒すかどうかの判定）ため、クリーンアップ時点で読んでも安全
          // eslint-disable-next-line react-hooks/exhaustive-deps
          if (canEdit && !conflictRef.current && !parseBrokenRef.current) {
            void updateMinutes(meetingId, currentContentRef.current, baseUpdatedAtRef.current).catch(() => {
              // アンマウント後は表示するすべが無い。次に開いたときの取り直しに委ねる
            })
          }
        }
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- アンマウント時の1回だけの送信。依存を増やすとその都度クリーンアップが走ってしまう
    }, [])

    // 未保存の間はページを閉じる/離れる前に確認を出す
    useEffect(() => {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        const isDirty = currentContentRef.current !== baselineRef.current
        if (!isDirty) return
        e.preventDefault()
        e.returnValue = ''
      }
      window.addEventListener('beforeunload', handleBeforeUnload)
      return () => window.removeEventListener('beforeunload', handleBeforeUnload)
    }, [])

    useImperativeHandle(
      ref,
      () => ({
        flushPendingSave: async () => {
          if (!canEdit) throw new Error('この会議の議事録を編集する権限がありません')
          if (parseBrokenRef.current) throw new Error('議事録の形式が壊れているため保存できません')
          if (conflictRef.current) throw new Error('この議事録は、別の場所で更新されています。保存できていません')

          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
            if (savingRef.current) {
              // 既に別の保存が通信中。今回は流さず、取りこぼさないようキューにだけ乗せる
              pendingContentRef.current = currentContentRef.current
              throw new Error('議事録を保存中です。少し待ってからもう一度お試しください')
            }
            await scheduleSave(currentContentRef.current)
          } else if (savingRef.current) {
            throw new Error('議事録を保存中です。少し待ってからもう一度お試しください')
          }

          if (conflictRef.current) throw new Error('この議事録は、別の場所で更新されています。保存できていません')
          if (lastSaveFailedRef.current) throw new Error('議事録を保存できませんでした')
          return baselineRef.current
        },
        getBaseUpdatedAt: () => baseUpdatedAtRef.current,
      }),
      [canEdit, scheduleSave]
    )

    const effectiveEditable = canEdit && !parseBrokenRef.current

    return (
      <>
        {conflict && (
          <div data-testid="minutes-conflict-banner" className="px-6 py-3 bg-orange-50 border-b border-orange-200 flex-shrink-0">
            <p className="text-sm text-orange-ink">{CONFLICT_MESSAGE}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCopyDraft}
                className="text-xs font-medium text-orange-ink hover:underline underline"
              >
                書きかけをコピー
              </button>
              <button
                type="button"
                onClick={onRequestReload}
                className="text-xs font-medium text-orange-ink hover:underline underline"
              >
                最新を読み込む
              </button>
            </div>
          </div>
        )}

        {isEmpty && !conflict && (
          <div data-testid="minutes-empty-notice" className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
            <p className="text-xs text-gray-500">本文が空です。保存されていません</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto py-6 px-4">
            {!initialMinutesMd && (
              <div className="mb-4 flex items-start gap-2 text-sm text-gray-400">
                <Notebook className="text-base mt-0.5 flex-shrink-0" />
                <p>ここに議事録を書きます。会議の前に、決めることや進め方を書いておくこともできます。</p>
              </div>
            )}
            <MinutesEditorDynamic
              minutesMd={initialMinutesMd}
              onChange={canEdit ? handleEditorChange : undefined}
              editable={effectiveEditable}
              orgId={orgId}
              spaceId={spaceId}
            />
          </div>
        </div>
      </>
    )
  }
)

// =====================================================================================
// 外側: 読み込み中/エラーを出す。開くたび（マウント時・会議を切り替えたとき）に必ず
// fetchMeetingDetail で詳細を取り直し、その結果が届いてから初めて内側をマウントする。
// 一覧のキャッシュ（meeting プロパティの minutes_md・updated_at）が裏で変わっても、
// ここでは見ない（内側は key が変わらない限り作り直さない）。
// =====================================================================================

export const MinutesDocumentView = forwardRef<MinutesDocumentViewHandle, MinutesDocumentViewProps>(
  function MinutesDocumentView(
    { orgId, spaceId, meeting, canEdit, onBack, onOpenInfo, updateMinutes, fetchMeetingDetail },
    ref
  ) {
    type Phase = 'loading' | 'loaded' | 'error'
    const [phase, setPhase] = useState<Phase>('loading')
    const [detail, setDetail] = useState<Meeting | null>(null)
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
    const loadTokenRef = useRef(0)
    const bodyRef = useRef<MinutesDocumentBodyHandle>(null)

    const load = useCallback(
      async (meetingId: string) => {
        const token = ++loadTokenRef.current
        setPhase('loading')
        setSaveState('idle')
        try {
          const fresh = await fetchMeetingDetail(meetingId)
          if (loadTokenRef.current !== token) return
          if (!fresh) {
            setPhase('error')
            return
          }
          setDetail(fresh)
          setPhase('loaded')
        } catch {
          if (loadTokenRef.current !== token) return
          setPhase('error')
        }
      },
      [fetchMeetingDetail]
    )

    // 開いたら（マウント時）・会議を切り替えたら、必ず最新の詳細を取り直す。
    // 一覧キャッシュ由来の meeting.minutes_md・meeting.updated_at の変化では取り直さない
    // （依存配列は意図的に meeting.id だけにする）。
    useEffect(() => {
      void load(meeting.id)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 会議を開いた/切り替えたときだけ取り直す
    }, [meeting.id])

    const handleReloadLatest = useCallback(() => {
      void load(meeting.id)
    }, [load, meeting.id])

    const handleBack = useCallback(async () => {
      try {
        await bodyRef.current?.flushPendingSave()
      } catch {
        // 保存を待つのはベストエフォート。失敗しても一覧へ戻ることは妨げない
      }
      onBack()
    }, [onBack])

    useImperativeHandle(
      ref,
      () => ({
        flushPendingSave: async () => {
          if (!bodyRef.current) throw new Error('議事録をまだ読み込めていません')
          return bodyRef.current.flushPendingSave()
        },
        getBaseUpdatedAt: () => bodyRef.current?.getBaseUpdatedAt() ?? null,
      }),
      []
    )

    const heldAtLabel = meeting.held_at ? new Date(meeting.held_at).toLocaleString('ja-JP') : '未設定'
    const bodyKey = detail ? `${detail.id}-${detail.updated_at}` : 'none'

    return (
      <div data-testid="minutes-document-view" className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-surface flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => void handleBack()}
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

        {phase === 'loading' && (
          <div className="flex items-center justify-center py-16">
            <span className="text-sm text-gray-400">読み込み中...</span>
          </div>
        )}

        {phase === 'error' && (
          <ErrorRetry message="議事録を読み込めませんでした" onRetry={handleReloadLatest} />
        )}

        {phase === 'loaded' && detail && (
          <MinutesDocumentBody
            key={bodyKey}
            ref={bodyRef}
            orgId={orgId}
            spaceId={spaceId}
            meetingId={detail.id}
            canEdit={canEdit}
            initialMinutesMd={detail.minutes_md ?? ''}
            initialUpdatedAt={detail.updated_at}
            updateMinutes={updateMinutes}
            fetchMeetingDetail={fetchMeetingDetail}
            onSaveStateChange={setSaveState}
            onRequestReload={handleReloadLatest}
          />
        )}
      </div>
    )
  }
)
