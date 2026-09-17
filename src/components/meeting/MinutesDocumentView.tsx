'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
} from 'react'
import { ArrowLeft, ArrowsIn, ArrowsOut, Info, Notebook, PencilSimple } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { MinutesEditorDynamic } from './MinutesEditorDynamic'
import { EditorLoadingFallback } from '@/components/editor/EditorLoadingFallback'
import { useMinutesTaskActions } from '@/lib/hooks/useMinutesTaskActions'
import { saveMinutesScroll, takeMinutesScroll } from '@/lib/minutes/scrollMemory'
import type { MinutesEditorApi } from './MinutesEditor'
import { parseMinutesMarkdown, serializeMinutesBlocks } from '@/lib/minutes/markdown'
import { appendOnlyAddition } from '@/lib/minutes/rebase'
// 競合の型は、フック（useMeetings）ではなく差し替えられない置き場から取る。
// 画面のテストは useMeetings をまるごとモックすることがあり、そこから取ると
// 型が undefined になって instanceof が壊れる（理由は errors.ts のコメント）。
import { MinutesConflictError } from '@/lib/minutes/errors'
import type { DegradeReason } from '@/lib/collab/session'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import type { MinutesPresencePeer } from '@/lib/hooks/useMinutesPresence'
import { useMinutesCollab } from '@/lib/hooks/useMinutesCollab'
import { isCollabEnabledForOrg } from '@/lib/collab/flag'
import { minutesContentHash, readSavedState, writeSavedState } from '@/lib/collab/scribe'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { ErrorRetry, useConfirmDialog } from '@/components/shared'
import { SAVING } from '@/lib/design/tokens'
import type { Meeting } from '@/types/database'

const AUTO_SAVE_DEBOUNCE_MS = 1500
const SAVED_BADGE_MS = 2000
/**
 * AI秘書の末尾追記との合流が「一時的な事情（'busy'）」で取り込めなかったとき、
 * 帯を出さずにやり直す間隔。要素数がそのままやり直す回数（この配列を使い切ったら
 * 帯を出す）。タスク化中の読み取り専用は数秒で終わる想定、日本語の変換(IME)中は
 * もっと短く終わる想定だが、両方をまとめて「少し待って2回まで試す」にしている。
 */
const APPEND_RETRY_DELAYS_MS = [1_500, 3_000]

const CONFLICT_MESSAGE =
  'AI秘書やほかの人が、この議事録を先に書き換えました。あなたが書いた分はまだ保存されていません。' +
  '「書きかけをコピー」で控えてから「最新を読み込む」を押してください（読み込むと、この画面の書きかけは消えます）。'

/** 保存に確定していないまま呼ばれた flushPendingSave/ensureUpToDate の失敗理由 */
export class MinutesSaveInProgressError extends Error {
  constructor(message = '議事録を保存中です。少し待ってからもう一度お試しください') {
    super(message)
    this.name = 'MinutesSaveInProgressError'
  }
}

export class MinutesSaveFailedError extends Error {
  constructor(message = '議事録を保存できませんでした') {
    super(message)
    this.name = 'MinutesSaveFailedError'
  }
}

interface UpdateMinutesResult {
  minutesMd: string | null
  updatedAt: string
}

export interface MinutesDocumentViewHandle {
  /**
   * 保留中の（デバウンス待ちの）保存があれば即座に流し、保存が確定した「サーバーにあると
   * 分かっている生の本文」を返す（正規化済みの表示用baselineではない。編集していない
   * 議事録をタスク化のために書き換えないため）。保留中の保存が無ければ、何もせず今の
   * （確定済みの）本文をそのまま返す。競合中・保存に失敗した・別の保存が通信中
   * （同時に2本流さない）のいずれかなら、本文は返さず例外を投げる。
   */
  flushPendingSave: () => Promise<string>
  /**
   * サーバー側の最新のupdated_atを読み、いま分かっている基準と合っているか確かめる。
   * 合っていれば何もしない。ずれていても、本文自体は変わっていなければ（会議の開始/終了
   * など本文以外の更新でupdated_atだけ進んだだけなら）基準を差し替えて通す。本文が
   * 本当に違えば競合状態にして例外を投げる。タスク化の直前など、保存確定後にもう一段
   * 確かめたいときに呼ぶ。
   */
  ensureUpToDate: () => Promise<void>
  /** 今わかっている保存の基準(updated_at)。詳細をまだ読み込めていなければ null */
  getBaseUpdatedAt: () => string | null
  /**
   * 今わかっている「サーバーにあると分かっている生の本文」。詳細をまだ読み込めて
   * いなければ null。一覧のキャッシュ(minutes_md)に頼らず候補確認・タスク化の本文を
   * 用意したい呼び出し側（MeetingsPageClient → MeetingInspector）のために公開する
   * （HIGH-N3）。副作用は無い（同期・通信しない）。
   */
  getKnownRaw: () => string | null
  /**
   * 保存されていない書きかけがあれば確認してから離れてよいか判定する（MEDIUM-B）。
   * true を返したときだけ呼び出し側は実際に画面を離れる。
   */
  confirmLeave: () => Promise<boolean>
  /**
   * 競合状態にして帯を出す（以後の自動保存も止める）。保存や ensureUpToDate では
   * 気づけなかった競合——タスク化の RPC が DB 側で「渡された本文が今の本文と違う」と
   * 断ったとき——に、呼び出し側（MeetingsPageClient）から同じ帯を出すために使う。
   * 通信はしない。
   */
  markConflict: () => void
  /**
   * タスク化が通ったあと、同じ議事録を開いている人へ「列を読み直して」と伝える。
   * タスク化は DB 側で行末に目印を足すので、伝えないと相手の器と列がずれたままになり、
   * 相手の書いた内容がそれ以降いっさい保存されなくなる。同時編集を使っていなければ
   * 何もしない。
   */
  notifyRoomReload: () => void
}

interface MinutesDocumentViewProps {
  orgId: string
  spaceId: string
  meeting: Meeting
  /** この space を編集できるか。会議の status では決めない（予定の会議でも書ける） */
  canEdit: boolean
  /** タスク化中など、一時的に読み取り専用にしたいときに true にする（canEditとは別軸） */
  forceReadOnly?: boolean
  onBack: () => void
  /** モバイルの情報ボタン。押すと親が会議詳細（Inspector）をシートで開く */
  onOpenInfo: () => void
  updateMinutes: (meetingId: string, minutesMd: string, baseUpdatedAt: string) => Promise<UpdateMinutesResult>
  fetchMeetingDetail: (meetingId: string) => Promise<Meeting | null>
  /**
   * 全画面表示（Wiki と同じ「全画面」）。状態は呼び出し側（MeetingsPageClient）が画面の枠
   * （AppShell）から `useShellFullscreen` で借りて持つ。ここでは呼ばない —
   * useShellFullscreen は AppShell の中でしか呼べない上、このコンポーネント自身を直接
   * マウントする既存テストが複数あり（MinutesDocumentView.*.test.tsx）、部品を
   * AppShell の context に縛り付けないため。両方揃っているときだけボタンを描く。
   */
  fullscreen?: boolean
  onToggleFullscreen?: () => void
  /**
   * 会議メモに残す「書いた人」の名前。メンバー一覧は呼び出し側（MeetingsPageClient）で読む —
   * このコンポーネントを直接マウントする既存テストが多く、ここで一覧を読むと全部に
   * 代役が要るため（全画面の状態を props で受けているのと同じ考え方）。
   */
  noteAuthorName?: string
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

/** 「〇〇さんが書いています」「〇〇さん、△△さんが書いています」 */
function formatEditingMessage(peers: MinutesPresencePeer[]): string {
  return `${peers.map((peer) => `${peer.name}さん`).join('、')}が書いています`
}

/**
 * 同時編集をやめて1人で書く形に戻ったときの知らせ。
 * 書いた内容が消えるわけではないので、そこを最初に伝える。
 * 本文が二重になった場合（duplicate-seed）はこの帯を出さず、列から読み直す。
 */
function degradeMessage(reason: DegradeReason): string | null {
  const tail = '書いた内容はこれまでどおり保存されます'
  if (reason === 'duplicate-seed') return null
  if (reason === 'too-many-peers') {
    return `開いている画面が多いので、いまは一人ずつ書く形に戻しました。${tail}`
  }
  if (reason === 'too-large') {
    return `議事録が長くなったので、いまは一人ずつ書く形に戻しました。${tail}`
  }
  if (reason === 'peer-outdated') {
    return (
      '同じ議事録を、更新前の画面で開いている人がいます。いまは一人ずつ書く形にします。' +
      `あとでこの画面を開き直すと、また一緒に書けます。${tail}`
    )
  }
  if (reason === 'apply-failed') {
    return `ほかの人の書いた内容を取り込めなかったので、いまは一人ずつ書く形に戻しました。${tail}`
  }
  return `つながりが切れたので、いまは一人ずつ書く形に戻しました。${tail}`
}

/** 表示に使う自分の名前。取れなければ「メンバー」（在席の既定と揃える） */
function displayNameOf(user: { email?: string | null; user_metadata?: Record<string, unknown> } | null): string {
  const metaName = user?.user_metadata?.name
  if (typeof metaName === 'string' && metaName.trim()) return metaName.trim()
  const localPart = user?.email?.split('@')[0]
  return localPart || 'メンバー'
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
  ensureUpToDate: () => Promise<void>
  getBaseUpdatedAt: () => string
  getKnownRaw: () => string
  /** 保存されていない書きかけ(未確定)があるか */
  hasUnconfirmedDraft: () => boolean
  /** 競合状態にして帯を出す（外から気づいた競合を、保存が0行だったときと同じ扱いにする） */
  markConflict: () => void
  /** 同じ議事録を開いている人へ「列を読み直して」と伝える */
  notifyRoomReload: () => void
  /** 「捨てて戻る」が選ばれた印を立てる。以後アンマウント時の後始末で送らない（N4） */
  discardDraft: () => void
}

interface MinutesDocumentBodyProps {
  orgId: string
  spaceId: string
  meetingId: string
  canEdit: boolean
  forceReadOnly: boolean
  /** 全画面表示中は編集領域を広く見せる（max-w-4xl → max-w-6xl） */
  fullscreen?: boolean
  /** 開いたときに取り直した詳細の本文。マウント時にだけ使う（以後の変化は見ない） */
  initialMinutesMd: string
  /** 同じ詳細取得で届いた updated_at。保存の基準にする */
  initialUpdatedAt: string
  updateMinutes: MinutesDocumentViewProps['updateMinutes']
  fetchMeetingDetail: MinutesDocumentViewProps['fetchMeetingDetail']
  onSaveStateChange: (state: 'idle' | 'saving' | 'saved') => void
  /** 「最新を読み込む」。外側に取り直しを頼み、外側が key を変えて作り直す */
  onRequestReload: () => void
  noteAuthorName?: string
}

const MinutesDocumentBody = forwardRef<MinutesDocumentBodyHandle, MinutesDocumentBodyProps>(
  function MinutesDocumentBody(
    {
      orgId,
      spaceId,
      meetingId,
      canEdit,
      forceReadOnly,
      fullscreen = false,
      initialMinutesMd,
      initialUpdatedAt,
      updateMinutes,
      fetchMeetingDetail,
      onSaveStateChange,
      onRequestReload,
      noteAuthorName,
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
    // 保存の後は更新結果の minutes_md、AI秘書の追記と合流できたときはその合流後の
    // サーバー本文。開始/終了などで updated_at だけが進んだ見せかけの競合と、
    // 本当に本文が変わった競合を区別するために使う（HIGH-2）。
    const knownServerRawRef = useRef(initialMinutesMd)
    const currentContentRef = useRef(initialBaseline.normalized)
    /** 本文をスクロールする枠。見ていた場所を覚えて戻すために持つ */
    const scrollBoxRef = useRef<HTMLDivElement | null>(null)
    // AI秘書の末尾追記との自動合流のための、生きているエディタへの差し込み口
    // （MinutesEditor が登録する）。本体（このコンポーネント）は作り直さない。
    const editorApiRef = useRef<MinutesEditorApi | null>(null)
    // 末尾追記の合流が一時的な事情('busy')でやり直した回数。APPEND_RETRY_DELAYS_MS を
    // 使い切ったら帯を出す。合流が成功('applied')したら 0 に戻す。
    const appendRetryCountRef = useRef(0)
    // 合流の差し込み中だけ立てる（低2）。差し込みは自分がキーボードで書いた変更では
    // ないので、この間だけ handleEditorChange の setEditing(true) を抑える
    // （立てたままだと、席を外していても他の人に最大60秒「〇〇さんが書いています」
    // と出てしまう）。
    const isApplyingRemoteRef = useRef(false)
    // scheduleSave は runSave に依存する（下で定義）ため、runSave 自身の中から
    // 呼びたい（busy のやり直しタイマー）場合は素直に依存配列へ足せない
    // （相互再帰になり、かつ scheduleSave はまだ宣言されていない）。ref 経由で
    // 呼ぶことで、この循環を避ける（下の「アンマウント時のクリーンアップ」と同じ形）。
    const scheduleSaveRef = useRef<((content: string) => Promise<void>) | null>(null)
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const conflictRef = useRef(false)
    // 保存は同時に1本だけ。通信中に来た本文は最後の1つだけ残し、今の保存が終わってから送る
    const savingRef = useRef(false)
    const pendingContentRef = useRef<string | null>(null)
    const lastSaveFailedRef = useRef(false)
    const saveChainRef = useRef<Promise<void> | null>(null)
    // 「捨てて戻る」が選ばれた印（N4）。立っている間はアンマウント時の後始末で送らない
    const discardedRef = useRef(false)

    const onSaveStateChangeRef = useRef(onSaveStateChange)
    onSaveStateChangeRef.current = onSaveStateChange

    // 「いま誰が書いているか」と、同時編集。書ける人だけが送り合う
    // （閲覧だけの人・相手先は購読しない）。本体がマウントされている＝詳細を
    // 読み込み終えているので、ここで始めてよい。
    const { user } = useCurrentUser()
    const selfUserId = user?.id ?? ''
    const selfName = displayNameOf(user)
    const {
      others,
      setEditing,
      active: collabActive,
      isScribe,
      fragment,
      awareness,
      meta: collabMeta,
      isApplyingRemote,
      synced: collabSynced,
      colorIndex,
      pending: collabPending,
      solo: collabSolo,
      degradedReason,
      registerSeeder,
      requestRoomReload,
    } = useMinutesCollab({
      meetingId,
      presenceEnabled: canEdit && !!selfUserId,
      self: { userId: selfUserId, name: selfName },
      collabAllowed: isCollabEnabledForOrg(orgId),
      initialMarkdown: initialMinutesMd,
      // 部屋の誰かがタスク化した。DB 側で行末に目印が足されるので、器の本文と列が
      // ずれる。そのまま書き続けると次の保存が必ず弾かれるため、読み直す
      onRoomReload: () => {
        discardedRef.current = true
        conflictRef.current = true
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        onRequestReload()
      },
    })
    const editingPeers = others.filter((peer) => peer.editing)

    /** 同時編集中に、列へ保存するのは書記1人だけ（全員でやると弾き合う） */
    const isScribeRef = useRef(isScribe)
    isScribeRef.current = isScribe
    const collabActiveRef = useRef(collabActive)
    collabActiveRef.current = collabActive
    const collabSyncedRef = useRef(collabSynced)
    collabSyncedRef.current = collabSynced
    const collabMetaRef = useRef(collabMeta)
    collabMetaRef.current = collabMeta

    /**
     * エディタが載ったら、種をまく係も一緒に登録する。器に本文を入れられるのは
     * ProseMirror のスキーマを持っているエディタだけなので、合流はここから始まる。
     *
     * 本文と一緒に、それを読んだときの列の更新時刻も渡す。ほぼ同時に開いた2人が
     * 違う本文から作ってしまったとき、**どちらが新しいか**をこれで決める。
     */
    const registerEditorApi = useCallback(
      (api: MinutesEditorApi | null) => {
        editorApiRef.current = api
        registerSeeder(
          api
            ? (doc) => ({
                seedHash: api.seedCollabDoc(doc, initialMinutesMd),
                basis: initialUpdatedAt,
              })
            : null
        )
      },
      [registerSeeder, initialMinutesMd, initialUpdatedAt]
    )

    /** エディタ領域の外へカーソルが出たときだけ「書いています」を下ろす */
    const handleEditorBlur = useCallback(
      (e: ReactFocusEvent<HTMLDivElement>) => {
        const next = e.relatedTarget as Node | null
        if (next && e.currentTarget.contains(next)) return
        setEditing(false)
      },
      [setEditing]
    )

    const handleEditorFocus = useCallback(() => {
      setEditing(true)
    }, [setEditing])

    // アンマウント時のクリーンアップ（deps=[]で1回だけ作られる）から常に最新の値・関数を
    // 読めるよう、ref に都度反映する（MEDIUM-A: 最初 canEdit=false だった場合の漏れ防止）
    const canEditRef = useRef(canEdit)
    canEditRef.current = canEdit

    const setSaveState = useCallback((state: 'idle' | 'saving' | 'saved') => {
      onSaveStateChangeRef.current(state)
    }, [])

    /**
     * サーバーの現在の詳細を読み、3通りに分けて判定する。
     * - 'same': 本文が「知っている生の本文」と同じ（＝開始/終了などで updated_at
     *   だけ進んだ見せかけの競合）。基準だけ差し替えて保存を続けられる。
     * - 'appended': 本文が変わっているが、AI秘書やチャットの末尾追記
     *   （rpc_minutes_append）だけが原因と分かる（appendOnlyAddition 参照）。
     *   足された分の Markdown・サーバー側の生の本文・updated_at を持って返す。
     *   ここでは合流「後」の本文は組み立てない（呼び出し側がエディタへ挿し込む）。
     * - 'conflict': それ以外（本当の競合・読み直し自体に失敗）。
     */
    const tryRebaseFromServer = useCallback(async (): Promise<
      { kind: 'same' } | { kind: 'appended'; addition: string; serverRaw: string; updatedAt: string } | { kind: 'conflict' }
    > => {
      let fresh: Meeting | null = null
      try {
        fresh = await fetchMeetingDetail(meetingId)
      } catch {
        fresh = null
      }
      if (!fresh) return { kind: 'conflict' }
      const freshRaw = fresh.minutes_md ?? ''
      if (freshRaw === knownServerRawRef.current) {
        baseUpdatedAtRef.current = fresh.updated_at
        return { kind: 'same' }
      }
      // 同時編集中、部屋の中の人が保存した分は競合ではない。内容は器で既に全員に
      // 届いているので、基準だけ差し替えて書き直せばよい
      const saved = collabMetaRef.current ? readSavedState(collabMetaRef.current) : null
      if (
        collabActiveRef.current &&
        saved?.savedAt === fresh.updated_at &&
        saved?.savedHash === minutesContentHash(freshRaw)
      ) {
        baseUpdatedAtRef.current = fresh.updated_at
        knownServerRawRef.current = freshRaw
        return { kind: 'same' }
      }
      const addition = appendOnlyAddition(knownServerRawRef.current, freshRaw)
      if (addition !== null) {
        return { kind: 'appended', addition, serverRaw: freshRaw, updatedAt: fresh.updated_at }
      }
      return { kind: 'conflict' }
    }, [fetchMeetingDetail, meetingId])

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
            // 同時編集中は、次の書記がここから基準を引き継ぐ（自分が開いたときの
            // 古い updated_at を使わせない）
            if (collabMetaRef.current) {
              writeSavedState(collabMetaRef.current, {
                savedAt: result.updatedAt,
                savedHash: minutesContentHash(content),
              })
            }
            setSaveState('saved')
            if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
            savedBadgeTimerRef.current = setTimeout(() => setSaveState('idle'), SAVED_BADGE_MS)
            break
          } catch (err) {
            if (err instanceof MinutesConflictError && !attempted0Row) {
              attempted0Row = true
              // 0行だった。開始/終了など本文以外の更新で updated_at だけが進んだ見せかけの
              // 競合か、AI秘書の末尾追記だけが原因の競合かもしれないので、読み直して確かめる。
              const outcome = await tryRebaseFromServer()
              if (outcome.kind === 'same') {
                base = baseUpdatedAtRef.current
                continue
              }
              if (outcome.kind === 'appended') {
                // 末尾への追記だけが原因と分かった。生きているエディタの末尾に
                // 差し込む（本体は作り直さない）。ここで本物の BlockNote
                // トランザクションが起きるので、この直後の onChange から
                // いつもどおりの自動保存が走る（保存をここで自前に組み立てない）。
                // 差し込み口が無い（editorApiRef.current が無い＝エディタがまだ
                // 載っていないだけ）ときも、一時的な 'busy' と同じ扱いにする。
                isApplyingRemoteRef.current = true
                const applyResult = editorApiRef.current?.appendMarkdown(outcome.addition) ?? 'busy'
                isApplyingRemoteRef.current = false

                if (applyResult === 'applied') {
                  appendRetryCountRef.current = 0
                  // baselineRef はあえて触らない: エディタの中身（追記が挿し込まれた後）と
                  // 基準がここで食い違う状態にすることで、直後の onChange が「開いたときと
                  // 同じ内容」の早期returnに吸収されず、自動保存の道に必ず乗る。
                  knownServerRawRef.current = outcome.serverRaw
                  baseUpdatedAtRef.current = outcome.updatedAt
                  // 低1: 差し込みの onChange（上のappendMarkdown呼び出しの中で同期的に
                  // 発火する）が張った通常のデバウンスタイマーはここで畳む。savingRef は
                  // まだ真の間にその onChange が来ているので、handleEditorChange が
                  // pendingContentRef に必ず積んでおり、この runSave 終了後の連鎖保存で
                  // 確実に送られる（取りこぼさない）。放置すると同じ内容の保存が
                  // もう1回余分に走ってしまう。
                  if (saveTimerRef.current) {
                    clearTimeout(saveTimerRef.current)
                    saveTimerRef.current = null
                  }
                  toast.success('ほかから追記された分を取り込みました')
                  setSaveState('idle')
                  break
                }

                if (applyResult === 'busy') {
                  // 一時的な事情（タスク化中の読み取り専用・日本語の変換中）。帯は
                  // 立てず、決めた回数だけ間を置いてやり直す。本文は currentContentRef
                  // に残っているので、ここで pendingContentRef を空にしても
                  // 取りこぼさない（すぐ走る連鎖保存で回数を一気に使い切らないため）。
                  const attemptIndex = appendRetryCountRef.current
                  if (attemptIndex < APPEND_RETRY_DELAYS_MS.length) {
                    appendRetryCountRef.current = attemptIndex + 1
                    pendingContentRef.current = null
                    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
                    saveTimerRef.current = setTimeout(() => {
                      saveTimerRef.current = null
                      void scheduleSaveRef.current?.(currentContentRef.current)
                    }, APPEND_RETRY_DELAYS_MS[attemptIndex])
                    setSaveState('idle')
                    break
                  }
                  // 回数を使い切った → 今までどおり帯を出す
                  conflictRef.current = true
                  setConflict(true)
                  lastSaveFailedRef.current = true
                  setSaveState('idle')
                  break
                }

                // 'failed': 恒久的に取り込めない。待っても直らないので帯を出す。
                conflictRef.current = true
                setConflict(true)
                lastSaveFailedRef.current = true
                setSaveState('idle')
                break
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
      [meetingId, updateMinutes, setSaveState, tryRebaseFromServer]
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

    // アンマウント時のクリーンアップ・runSave内部(busyのやり直し)から常に最新の
    // scheduleSave を呼べるようにする（宣言は上の方に前出し済み）
    scheduleSaveRef.current = scheduleSave

    /**
     * 書記を引き継いだとき（前の書記が画面を閉じた）。
     *
     * 自分が開いたときの古い基準のまま列へ書きに行くと必ず弾かれるので、**引き継いだ
     * 時点の列を読み直して**基準を取り直す。そのうえで、いま器にある内容が列と違えば
     * 1回保存する（前の書記が抜けた瞬間の書きかけを取りこぼさないため）。
     */
    const wasScribeRef = useRef(false)
    useEffect(() => {
      if (!collabActive || !isScribe) {
        wasScribeRef.current = false
        return
      }
      if (wasScribeRef.current) return
      wasScribeRef.current = true
      // まだ誰も保存していない＝自分が最初の1人。引き継ぎではないので基準はそのまま
      const saved = collabMeta ? readSavedState(collabMeta) : { savedAt: null, savedHash: null }
      if (!saved.savedAt) return

      let cancelled = false
      void (async () => {
        try {
          const fresh = await fetchMeetingDetail(meetingId)
          if (cancelled || !fresh) return
          baseUpdatedAtRef.current = fresh.updated_at
          knownServerRawRef.current = fresh.minutes_md ?? ''
          const current = currentContentRef.current
          if (current.trim() === '') return
          if (minutesContentHash(knownServerRawRef.current) === minutesContentHash(current)) return
          void scheduleSaveRef.current?.(current)
        } catch {
          // 引き継ぎに失敗しても書けなくはしない。次の保存で競合の帯に倒れる
        }
      })()
      return () => {
        cancelled = true
      }
    }, [collabActive, isScribe, collabMeta, fetchMeetingDetail, meetingId])

    /**
     * 器に種が2つ入った＝本文が二重になっている。その内容は保存せず、列から読み直す。
     * （どうしてそうなるかは `src/lib/collab/seed.ts` の説明を参照）
     */
    const reloadedForDuplicateRef = useRef(false)
    useEffect(() => {
      if (degradedReason !== 'duplicate-seed') return
      // 読み直すと本体は作り直され、器も新しくなる。それでも解消しなかったときに
      // 読み直しを繰り返さないよう、1回だけにする
      if (reloadedForDuplicateRef.current) return
      reloadedForDuplicateRef.current = true
      discardedRef.current = true
      conflictRef.current = true
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      onRequestReload()
    }, [degradedReason, onRequestReload])

    const handleEditorChange = useCallback(
      (content: string) => {
        if (!canEdit || forceReadOnly || parseBrokenRef.current) return

        const trimmed = trimTrailingBlank(content)
        // 本文が実際に動いたときだけ「書いています」にする。BlockNote が初期表示直後に
        // 同じ内容で呼んでくるぶんでは立てない。合流の差し込み中（isApplyingRemoteRef）も
        // 自分がキーボードで書いたわけではないので立てない（低2）。
        // 相手の文字が流れ込んだぶんでは「書いています」を立てない（自分は書いていない）
        const fromSomeoneElse = isApplyingRemoteRef.current || isApplyingRemote()
        if (trimmed !== currentContentRef.current && !fromSomeoneElse) setEditing(true)
        currentContentRef.current = trimmed

        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }

        const isBlank = trimmed.trim() === ''

        // 保存が通信中なら、保留中に積む本文は常に「今の本文」に上書きする。基準と
        // 一致するかどうかに関わらず行う（LOW/R10: 戻し入力で古い内容が送られないように）。
        // ただし空になった場合は積まない(null にする) — 通信中に全部消しても、確定した
        // 本文が空で上書きされないように（HIGH-N2）。
        if (savingRef.current) {
          pendingContentRef.current = isBlank ? null : trimmed
        }

        // 開いたときと同じ内容（正規化済み比較）なら保存しない。BlockNote が初期表示
        // 直後に normalize 済みの内容で onChange を呼んできても、ここで吸収する。
        if (trimmed === baselineRef.current) {
          setIsEmpty(false)
          return
        }

        if (isBlank) {
          setIsEmpty(true)
          return
        }
        setIsEmpty(false)

        if (conflictRef.current) return
        // 同時編集中に列へ保存するのは書記1人だけ。全員が保存すると、更新時刻の
        // 突き合わせで互いを弾き合って誰も保存できなくなる。書いた内容は器を通じて
        // 全員に届いているので、保存する人が1人でも取りこぼしは起きない
        if (collabActiveRef.current && !isScribeRef.current) return

        saveTimerRef.current = setTimeout(() => {
          saveTimerRef.current = null
          // 待っているあいだに書記を降ろされていることがある（タブを切り替えると
          // 交代する）。古い基準のまま書きに行くと弾かれるので、ここでもう一度見る
          if (collabActiveRef.current && !isScribeRef.current) return
          void scheduleSave(trimmed)
        }, AUTO_SAVE_DEBOUNCE_MS)
      },
      [canEdit, forceReadOnly, scheduleSave, setEditing, isApplyingRemote]
    )

    const handleCopyDraft = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(currentContentRef.current)
        toast.success('書きかけをコピーしました')
      } catch {
        toast.error('コピーできませんでした')
      }
    }, [])

    // アンマウント時（左メニュー・ブラウザの戻る等で待たずに離れた場合を含む）は、保留中の
    // 本文を scheduleSave 経由で送る（保存と全く同じ道: 通信中なら次に回し、0行なら基準を
    // 差し替える）。state を新たに作らずrefだけで完結させ、常に最新のcanEdit/scheduleSaveを
    // 見る（MEDIUM-A）。
    // N6（既知の限界）: ブラウザの戻る・左メニューでの離脱はコンポーネントの同期的な
    // アンマウントとして届くため、ここで確認ダイアログを挟むことはできない（Next.js
    // App Router の制約）。保留中の本文はここで送るが、競合中・保存失敗中の書きかけは
    // （確認する間が無いため）そのまま消える。
    useEffect(() => {
      return () => {
        if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current)
          saveTimerRef.current = null
        }
        const isDirty = currentContentRef.current !== baselineRef.current
        // 空にしてから離れても保存しない（CRITICAL-N1: 消したことがそのまま確定して
        // 議事録が空で上書きされないように）。「捨てて戻る」が選ばれていた場合も送らない（N4）。
        const isBlank = currentContentRef.current.trim() === ''
        // 同時編集中は、書記がもう同じ内容を保存していれば送らない（送ると、
        // 古い基準で書きに行って無駄に弾かれる）。逆に**まだ保存されていなければ
        // 書記でなくても送る** — 最後の1人が閉じた場面を取りこぼさないため
        const savedHash = collabMetaRef.current ? readSavedState(collabMetaRef.current).savedHash : null
        const alreadySaved =
          savedHash !== null && savedHash === minutesContentHash(currentContentRef.current)
        if (
          canEditRef.current &&
          !conflictRef.current &&
          !parseBrokenRef.current &&
          !discardedRef.current &&
          isDirty &&
          !isBlank &&
          !alreadySaved
        ) {
          void scheduleSaveRef.current?.(currentContentRef.current)
        }
      }
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

    /**
     * 本文中のリンクで画面を移る前に呼ばれる。待ち時間の途中で移ると最後の一手が消えるので、
     * ここで保存を確定させる。保存できない状態（権限なし・形式が壊れている・別の場所で更新された）
     * のときは例外を投げて移動を止める。書きかけを消すより、その場で理由を読んでもらう
     */
    // 「タスク作成済み」の印からその場で完了・決定する入り口（読むのは押したときだけ）
  const taskActions = useMinutesTaskActions({ orgId, spaceId })

  /**
   * 本文の枠が現れたら、前に見ていた場所へ戻す。
   *
   * effect ではなく ref のコールバックで行う。effect だと「先頭で1回描いてから動かす」
   * ことになり、一瞬先頭が見えてから飛ぶ。ここなら描く前に位置を決められる。
   * 本文が大きく変わっていたら戻さない（scrollMemory の判断）。
   *
   * 戻すのは**移動して帰ってきた1回だけ**（takeMinutesScroll が取り出して消す）。
   * この画面はタスク化のあとや「最新を読み込む」でも組み直されるので、覚えたままだと
   * そのたびに今読んでいた場所から飛ばされる。
   */
  const restoredForRef = useRef<string | null>(null)
  const restoreScroll = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return
      // 同じ会議で何度も戻さない（本文を打つたびに描き直されるため）
      if (restoredForRef.current === meetingId) return
      // 同時編集では本文が届くまでエディタを隠している。その間は枠に高さが無く、
      // 位置を入れても 0 に丸められる。覚えた位置は取り出したきり消えるので、
      // **届いてから**戻す
      if (!collabSyncedRef.current) return
      const top = takeMinutesScroll(meetingId, currentContentRef.current.length)
      if (top === null) {
        restoredForRef.current = meetingId
        return
      }
      el.scrollTop = top
      // 中身（エディタ）がまだ組み上がっていないと枠に高さが無く、代入は 0 に丸められる。
      // 効いたときだけ「戻した」ことにして、空振りなら1コマ待ってもう一度だけ試す
      if (el.scrollTop > 0) {
        restoredForRef.current = meetingId
        return
      }
      requestAnimationFrame(() => {
        const box = scrollBoxRef.current
        if (!box || restoredForRef.current === meetingId) return
        box.scrollTop = top
        restoredForRef.current = meetingId
      })
    },
    [meetingId]
  )

  const attachScrollBox = useCallback(
    (el: HTMLDivElement | null) => {
      scrollBoxRef.current = el
      restoreScroll(el)
    },
    [restoreScroll]
  )

  // 本文が届いたら、見ていた場所へ戻す（届く前は枠に高さが無くて戻せない）
  useEffect(() => {
    if (!collabSynced) return
    restoreScroll(scrollBoxRef.current)
  }, [collabSynced, restoreScroll])

  const handleBeforeNavigate = useCallback(async () => {
      // 見ていた場所を覚える。タスクや Wiki のリンクで移ると議事録は一から組み立て直され、
      // スクロールが先頭に戻るため（長い議事録では毎回探し直しになる）
      const box = scrollBoxRef.current
      if (box) saveMinutesScroll(meetingId, box.scrollTop, currentContentRef.current.length)

      if (saveTimerRef.current === null) return
      if (!canEdit || parseBrokenRef.current || conflictRef.current) {
        throw new Error('保存できていない変更があります')
      }
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      // ここは `?.` で黙って何もしない形にしない。保存せずに移ってしまうと、
      // 待ち時間の途中だった書きかけがそのまま消える（呼び出し側は「保存できた」と
      // 思って移動する）。取れないはずの状態だが、取れなければ移動を止める。
      const scheduleSaveNow = scheduleSaveRef.current
      if (!scheduleSaveNow) throw new Error('保存できていない変更があります')
      await scheduleSaveNow(currentContentRef.current)
    }, [canEdit, meetingId])

    useImperativeHandle(
      ref,
      () => ({
        flushPendingSave: async () => {
          if (!canEdit) throw new Error('この会議の議事録を編集する権限がありません')
          if (parseBrokenRef.current) throw new Error('議事録の形式が壊れているため保存できません')
          if (conflictRef.current) throw new MinutesConflictError('この議事録は、別の場所で更新されています。保存できていません')

          /**
           * 同時編集中は、**書記でなくてもここでは自分で1回保存する**。
           * タスク化の DB 側の処理は「渡した本文が列の本文と一致すること」を求める。
           * 書記でない人は普段保存しないので、基準も「サーバーにあると分かっている本文」も
           * 開いたときのまま止まり、必ず弾かれる（以後この人の入力が保存されなくなる）。
           * 器の中身はもう全員に届いているので、ここで列へ押し出しても取りこぼしは無い。
           */
          const savedState = collabMetaRef.current ? readSavedState(collabMetaRef.current) : null
          const needsCollabFlush =
            collabActiveRef.current &&
            currentContentRef.current.trim() !== '' &&
            savedState?.savedHash !== minutesContentHash(currentContentRef.current)
          if (needsCollabFlush && savedState?.savedAt) baseUpdatedAtRef.current = savedState.savedAt

          if (saveTimerRef.current || needsCollabFlush) {
            if (saveTimerRef.current) {
              clearTimeout(saveTimerRef.current)
              saveTimerRef.current = null
            }
            if (savingRef.current) {
              // 既に別の保存が通信中。今回は流さず、取りこぼさないようキューにだけ乗せる
              pendingContentRef.current = currentContentRef.current
              throw new MinutesSaveInProgressError()
            }
            await scheduleSave(currentContentRef.current)
          } else if (savingRef.current) {
            throw new MinutesSaveInProgressError()
          }

          if (conflictRef.current) throw new MinutesConflictError('この議事録は、別の場所で更新されています。保存できていません')
          if (lastSaveFailedRef.current) throw new MinutesSaveFailedError()
          // MEDIUM-C: 正規化した baseline ではなく、サーバーにあると分かっている生の本文を返す
          // （編集していない議事録をタスク化のために書き換えないため）
          return knownServerRawRef.current
        },
        ensureUpToDate: async () => {
          // N5: 詳細は1回だけ読む(この結果をそのまま使う。tryRebaseFromServerは呼ばない
          // ——呼ぶと同じ詳細をもう1回読みに行ってしまう)。
          // ここでは末尾追記との自動合流(appendMarkdown)も行わない: タスク化の直前は
          // これから ensureUpToDate の直後に「解析した本文」を使って書き戻す処理が
          // 続く。その途中でエディタへブロックを挿し込むと、解析した本文とこれから
          // 書き戻す本文がずれてしまう。ここは合流を試みず、本文が変わっていれば
          // 素直に競合の帯へ倒す（タスク化を保存確定済みの本文でやり直させる）。
          let fresh: Meeting | null = null
          try {
            fresh = await fetchMeetingDetail(meetingId)
          } catch {
            fresh = null
          }
          if (!fresh) throw new Error('議事録の状態を確かめられませんでした。もう一度お試しください')
          if (fresh.updated_at === baseUpdatedAtRef.current) return
          // 部屋の中の人が保存しただけなら競合ではない（内容は器で合流済み）
          const roomSaved = collabMetaRef.current ? readSavedState(collabMetaRef.current) : null
          const freshBody = fresh.minutes_md ?? ''
          if (
            collabActiveRef.current &&
            roomSaved?.savedAt === fresh.updated_at &&
            roomSaved?.savedHash === minutesContentHash(freshBody)
          ) {
            baseUpdatedAtRef.current = fresh.updated_at
            knownServerRawRef.current = freshBody
            return
          }
          const freshRaw = fresh.minutes_md ?? ''
          if (freshRaw === knownServerRawRef.current) {
            // 本文は変わっていない(開始/終了などでupdated_atだけ進んだ) → 基準だけ差し替える
            baseUpdatedAtRef.current = fresh.updated_at
            return
          }
          // 本文が本当に違う（本当の競合）→ 帯を出す（「最新を読み込む」も押せるように）
          conflictRef.current = true
          setConflict(true)
          throw new MinutesConflictError('この議事録は、別の場所で更新されています。保存できていません')
        },
        getBaseUpdatedAt: () => baseUpdatedAtRef.current,
        getKnownRaw: () => knownServerRawRef.current,
        hasUnconfirmedDraft: () => currentContentRef.current !== baselineRef.current,
        markConflict: () => {
          // 保留中のデバウンス保存も止める（古い基準のまま送ると、相手の書き込みを消す）
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current)
            saveTimerRef.current = null
          }
          conflictRef.current = true
          setConflict(true)
        },
        notifyRoomReload: requestRoomReload,
        discardDraft: () => {
          discardedRef.current = true
        },
      }),
      [canEdit, scheduleSave, fetchMeetingDetail, meetingId, requestRoomReload]
    )

    /**
     * 同時編集を使うときは、**本文が届くまで書けないようにする**。
     * 届くまでのあいだエディタは空なので、そこへ打つと、あとから届いた本文と混ざる。
     * ふつうは1秒かからない（同じ議事録を開いている人がすぐ返す）。
     */
    const effectiveEditable = canEdit && !forceReadOnly && !parseBrokenRef.current && collabSynced

    /**
     * エディタに渡す同時編集の入れ物。**同じ参照を保つ**のが要点。
     * 毎回作り直すと、在席の顔ぶれが動くたびに BlockNote ごと描き直してしまう
     * （`MinutesEditor` は memo 済みだが、この props だけが毎回別物になる）。
     */
    const collaboration = useMemo(
      () =>
        fragment && awareness
          ? { fragment, awareness, userName: selfName, colorIndex }
          : undefined,
      [fragment, awareness, selfName, colorIndex]
    )

    return (
      <>
        {conflict && (
          <div data-testid="minutes-conflict-banner" data-print-hide className="px-6 py-3 bg-orange-50 border-b border-orange-200 flex-shrink-0">
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
          <div data-testid="minutes-empty-notice" data-print-hide className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
            <p className="text-xs text-gray-500">本文が空です。保存されていません</p>
          </div>
        )}

        {/* 同時編集をやめて1人で書く形に戻ったときの知らせ。編集は止めない */}
        {degradedReason && degradeMessage(degradedReason) && (
          <div
            data-testid="minutes-collab-degraded-notice"
            data-print-hide
            className="px-6 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0"
          >
            <p className="text-xs text-gray-500">{degradeMessage(degradedReason)}</p>
          </div>
        )}

        {/* 知らせるだけの帯。編集は止めない（同時に書けてしまったときの砦は保存の楽観ロック） */}
        {editingPeers.length > 0 && (
          <div
            data-testid="minutes-presence-banner"
            data-print-hide
            className="px-6 py-2 bg-indigo-50 border-b border-gray-100 flex-shrink-0"
          >
            <p className="text-xs text-indigo-ink flex items-center gap-1.5">
              <PencilSimple className="text-sm flex-shrink-0" />
              {formatEditingMessage(editingPeers)}
            </p>
          </div>
        )}

        <div data-testid="minutes-scroll-box" className="flex-1 overflow-y-auto" ref={attachScrollBox}>
          <div
            data-testid="minutes-editor-region"
            className={fullscreen ? 'max-w-6xl mx-auto py-6 px-4' : 'max-w-4xl mx-auto py-6 px-4'}
            onFocus={handleEditorFocus}
            onBlur={handleEditorBlur}
          >
            {!initialMinutesMd && (
              <div data-print-hide className="mb-4 flex items-start gap-2 text-sm text-gray-400">
                <Notebook className="text-base mt-0.5 flex-shrink-0" />
                <p>ここに議事録を書きます。会議の前に、決めることや進め方を書いておくこともできます。</p>
              </div>
            )}
            {/* 器の用意が終わるまでエディタを載せない。先に載せると、あとから器を
                渡せない（BlockNote は載せるときに1回だけ受け取る）ので、同時編集に
                ならないまま固まる */}
            {/* 器の用意が終わるまで、そして本文が器に届くまではスケルトンを出す。
                同時編集のエディタは器の中身で本文を置き換えるので、届く前は空に見える
                （「開いたら議事録が消えた」に見えてしまう）。エディタ自体は
                ProseMirror のスキーマを貸すために載せたまま、見えなくしておく */}
            {(collabPending || !collabSynced) && <EditorLoadingFallback />}
            {collabPending ? null : (
              <div className={collabSynced ? undefined : 'hidden'}>
              <MinutesEditorDynamic
                // 器につながずに載せ替えるときは作り直す。つないだままだと、
                // 空の器に打った1文字で議事録が丸ごと消える
                key={collabSolo ? 'solo' : 'collab'}
                minutesMd={initialMinutesMd}
                onChange={canEdit && !forceReadOnly ? handleEditorChange : undefined}
                onBeforeNavigate={handleBeforeNavigate}
                editable={effectiveEditable}
                orgId={orgId}
                spaceId={spaceId}
                registerApi={registerEditorApi}
                // 印を押した操作とチェックでの完了は、書ける人のときだけ
                // 競合の帯が出ている間は止める。自動保存が早期 return するので、画面の
                // チェックだけ外れてサーバーには `[x]` が残る（見た目と中身がずれる）
                onResolveTask={canEdit && !forceReadOnly && !conflict ? taskActions : undefined}
                noteAuthorName={noteAuthorName}
                collaboration={collaboration}
                isApplyingRemote={isApplyingRemote}
              />
              </div>
            )}
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
    {
      orgId,
      spaceId,
      meeting,
      canEdit,
      forceReadOnly = false,
      onBack,
      onOpenInfo,
      updateMinutes,
      fetchMeetingDetail,
      fullscreen,
      onToggleFullscreen,
      noteAuthorName,
    },
    ref
  ) {
    type Phase = 'loading' | 'loaded' | 'error'
    const [phase, setPhase] = useState<Phase>('loading')
    const [detail, setDetail] = useState<Meeting | null>(null)
    const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
    const loadTokenRef = useRef(0)
    const bodyRef = useRef<MinutesDocumentBodyHandle>(null)
    const { confirm, ConfirmDialog } = useConfirmDialog()

    const load = useCallback(
      async (meetingId: string) => {
        const token = ++loadTokenRef.current
        setPhase('loading')
        setSaveState('idle')
        // 詳細の取得と同時にエディタ部品(BlockNote)の読み込みも始める（表示速度: 次の
        // 待ち時間を減らす。next/dynamic と同じチャンクを指すのでここで先に import
        // してもモジュールが二重に読み込まれることはない）
        void import('./MinutesEditor').catch(() => {})
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

    /**
     * 保存されていない書きかけがあれば確認してから離れてよいか判定する（MEDIUM-B）。
     * - 保存中(通信中)なら、あとで送られるのでそのまま離れてよい
     * - 競合中・保存失敗なら、捨ててよいか確認する
     * - それ以外(確定済み・権限が無い・形式が壊れている等)はそのまま離れてよい
     */
    const confirmLeave = useCallback(async (): Promise<boolean> => {
      try {
        await bodyRef.current?.flushPendingSave()
        return true
      } catch (err) {
        if (err instanceof MinutesSaveInProgressError) {
          return true
        }
        if (err instanceof MinutesConflictError || err instanceof MinutesSaveFailedError) {
          const ok = await confirm({
            title: '保存されていない書きかけがあります',
            message: '保存されていない書きかけを捨てて戻りますか？',
            confirmLabel: '捨てて戻る',
            variant: 'danger',
          })
          // N4: 「捨てて戻る」を選んだら印を立てる。以後アンマウント時の後始末で
          // この書きかけを送らない（送ってしまうと「捨てた」ことにならないため）。
          if (ok) bodyRef.current?.discardDraft()
          return ok
        }
        return true
      }
    }, [confirm])

    const handleBack = useCallback(async () => {
      const ok = await confirmLeave()
      if (!ok) return
      onBack()
    }, [confirmLeave, onBack])

    useImperativeHandle(
      ref,
      () => ({
        flushPendingSave: async () => {
          if (!bodyRef.current) throw new Error('議事録をまだ読み込めていません')
          return bodyRef.current.flushPendingSave()
        },
        ensureUpToDate: async () => {
          if (!bodyRef.current) throw new Error('議事録をまだ読み込めていません')
          return bodyRef.current.ensureUpToDate()
        },
        getBaseUpdatedAt: () => bodyRef.current?.getBaseUpdatedAt() ?? null,
        getKnownRaw: () => bodyRef.current?.getKnownRaw() ?? null,
        confirmLeave,
        markConflict: () => bodyRef.current?.markConflict(),
        notifyRoomReload: () => bodyRef.current?.notifyRoomReload(),
      }),
      [confirmLeave]
    )

    const heldAtLabel = meeting.held_at ? new Date(meeting.held_at).toLocaleString('ja-JP') : '未設定'
    const bodyKey = detail ? `${detail.id}-${detail.updated_at}` : 'none'
    // fullscreen/onToggleFullscreen が両方渡されているときだけ全画面ボタンを出す
    // （MinutesDocumentView を直接マウントする既存テストでは渡されず、ボタンは出ない）
    const showFullscreenControls = typeof fullscreen === 'boolean' && !!onToggleFullscreen

    return (
      // data-print-root: 「PDFで保存」(会議情報パネル)で刷るとき、紙に載せるのはこのかたまり
      // だけにする。中でも押すためのもの・知らせの帯には data-print-hide を付けて外す。
      // 実際に隠す指定は globals.css の @media print 側（Wiki と同じ仕組みを使う）。
      <div data-print-root data-testid="minutes-document-view" className="flex-1 flex flex-col min-h-0">
        {ConfirmDialog}
        <div className="flex items-center justify-between px-6 py-3 border-b border-gray-100 bg-surface flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* 全画面中は「戻る」を隠す（Wiki と同じ。閉じるには全画面を先に閉じる） */}
            {!fullscreen && (
              <button
                onClick={() => void handleBack()}
                data-print-hide
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                aria-label="会議一覧へ戻る"
              >
                <ArrowLeft className="text-lg" />
              </button>
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-gray-900 truncate">{meeting.title}</h1>
              <p className="text-xs text-gray-400">{heldAtLabel}</p>
            </div>
          </div>
          {/* 保存の状態・全画面・会議情報・お知らせベルは画面のためのもの。紙には載せない */}
          <div data-print-hide className="flex items-center gap-2 flex-shrink-0">
            {saveState === 'saving' && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 ${SAVING.dot} rounded-full animate-pulse`} />
                保存中...
              </span>
            )}
            {saveState === 'saved' && <span className="text-xs text-green-500">保存済み</span>}
            {/* 全画面表示（デスクトップのみ）。Wiki(WikiPageClient.tsx)と同じ見た目・testid規則にそろえる */}
            {showFullscreenControls && !fullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-pressed={fullscreen}
                data-testid="minutes-fullscreen-toggle"
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowsOut className="text-base" />
                全画面
              </button>
            )}
            {showFullscreenControls && fullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                data-testid="minutes-fullscreen-close"
                className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowsIn className="text-base" />
                全画面を閉じる
              </button>
            )}
            {/* 全画面中はモバイル用の情報ボタンも隠す（Wiki と同じ） */}
            {!fullscreen && (
              <button
                type="button"
                onClick={onOpenInfo}
                className="md:hidden p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                aria-label="会議情報"
              >
                <Info className="text-lg" />
              </button>
            )}
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
            forceReadOnly={forceReadOnly}
            fullscreen={fullscreen}
            initialMinutesMd={detail.minutes_md ?? ''}
            initialUpdatedAt={detail.updated_at}
            updateMinutes={updateMinutes}
            fetchMeetingDetail={fetchMeetingDetail}
            onSaveStateChange={setSaveState}
            onRequestReload={handleReloadLatest}
            noteAuthorName={noteAuthorName}
          />
        )}
      </div>
    )
  }
)
