'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { WikiConflictError, type UpdateWikiPageInput } from '@/lib/hooks/useWikiPages'
import type { WikiPage } from '@/types/database'
import type * as Y from 'yjs'
import { readSavedState, writeSavedState } from '@/lib/collab/scribe'
import { canonicalizeWikiBody, wikiAppendedBlocks, wikiContentHash } from './bodyMerge'

// 議事録の競合帯(MinutesDocumentView.tsx)と同じ文面の作り。Wiki には掲示板のような
// 自動合流・保存の直列化までは作らない（必要最小限）。
export const WIKI_CONFLICT_MESSAGE =
  'このページは、ほかの人（またはAI）が先に書き換えました。あなたが書いた分はまだ保存されていません。' +
  '「書きかけをコピー」で控えてから「最新を読み込む」を押してください（読み込むと、この画面の書きかけは消えます。' +
  '控えはそのままでは元の見た目には貼り戻せない形式です）。'

// 「最新を読み込む」で読み直したら、対象のページ自体が既に削除されていた場合の文面。
// 帯は下ろさず（自動保存を止めたまま）、理由だけをこちらに切り替える。
export const WIKI_PAGE_DELETED_MESSAGE =
  'このページは見つかりませんでした（削除された可能性があります）。自動保存は止まっています。'

type UpdatePage = (
  pageId: string,
  input: UpdateWikiPageInput,
  baseUpdatedAt?: string
) => Promise<{ updatedAt: string | null }>
type FetchPage = (pageId: string) => Promise<WikiPage | null>

/**
 * 同時編集の状態。ページの本文を描く部品（`WikiBodyEditor`）が、器の用意ができるたびに知らせる。
 * 同時編集を使わないときは `active: false` のまま（今までどおり全員が保存する）。
 */
export interface WikiCollabState {
  active: boolean
  /** 列へ保存する係か。同時編集中は1人だけ */
  isScribe: boolean
  /** 部屋で共有する覚え書き（最後に保存した更新時刻と本文の合言葉） */
  meta: Y.Map<unknown> | null
}

const NO_COLLAB: WikiCollabState = { active: false, isScribe: true, meta: null }

/** エディタから借りる差し込み口。本文を丸ごと差し替える・末尾へ足す */
export interface WikiEditorApi {
  /** 本文を丸ごと差し替える（ふつうの編集として。同時編集なら部屋の全員に届く）。できなければ false */
  replaceContent: (body: string | null) => boolean
  /** 末尾にブロックを足す。一時的にできない（読み取り専用・変換中）なら 'busy' */
  appendBlocks: (blocks: unknown[]) => 'applied' | 'busy' | 'failed'
}

/** 保存の基準にする、サーバーにある状態 */
export interface WikiBodyBaseline {
  /** どのページの状態か。渡すと、ほかのページ宛ての変更を受け付けなくなる */
  id?: string
  updated_at: string
  body: string | null
}

/**
 * 仕様の確定の追記を差し込めなかったとき（変換中・読み取り専用）にやり直す間隔。
 * 要素数がやり直す回数（議事録の APPEND_RETRY_DELAYS_MS と同じ）
 */
const APPEND_RETRY_DELAYS_MS = [1_500, 3_000]

/**
 * Wiki 本文の自動保存（1.5秒待ち）と、同時に書いたときに「黙って消える」を防ぐ仕組みの一式。
 * Wiki 画面（WikiPageClient）と、議事録の上に重ねた Wiki（WikiPageOverlay）が同じものを使う。
 * 片方だけ作り直すと、過去に塞いだ穴（偽の競合・前のページへの上書き・復元の取り消し）が
 * もう片方で開くため、ここを1か所の正本にする。
 *
 * - 楽観ロック: 基準の updated_at を渡して保存し、0行なら見せかけの競合かを確かめてから帯を出す
 * - 世代(epoch): ページを切り替えたら進め、古いページの保存結果を新しいページに書かない
 * - 直列化: 保存は同時に1本だけ。通信中の編集は終わってから続けて送る
 */
export function useWikiBodySave({ updatePage, fetchPage }: { updatePage: UpdatePage; fetchPage: FetchPage }) {
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null)
  /**
   * まだ保存していない本文。**どのページのものか**まで覚える。
   * ページを切り替えたあとに確定させると、前のページの本文で次のページを
   * 丸ごと上書きしてしまうため（ページIDを持たないと防げない）
   */
  const pendingBodyRef = useRef<{ pageId: string; body: string } | null>(null)
  const savedTimerRef = useRef<NodeJS.Timeout | null>(null)

  // 保存の合言葉（楽観ロック）まわり。基準の updated_at と、サーバーにあると分かっている
  // 本文を持つ。開いたとき(fetchPage)と、updatePage が成功した後（属性更新・版の復元を
  // 含むすべての呼び出し）に必ず両方更新する（そうしないと本文保存が偽の競合を出す）。
  const baseUpdatedAtRef = useRef<string | null>(null)
  const knownServerBodyRef = useRef<string | null>(null)
  // 今エディタに表示されている書きかけ（onChange の生値）。「書きかけをコピー」で使う。
  const currentContentRef = useRef<string>('')
  const [conflict, setConflict] = useState(false)
  // conflict(state) と同じ値を常に持つ ref。setConflict は再描画を経てから effect/closure に
  // 反映されるため、その間に発火する古い closure（タイマー・onChange）が「まだ競合していない」
  // と誤判定してしまう。同期に読めるこちらを判定に使う。
  const conflictRef = useRef(false)
  // 帯を「見つかりません」表示に切り替えるための状態。conflict=true のまま維持し、
  // 文面だけ変える（削除されたページは何度読み直しても null のままなので、帯を下ろさず
  // 安定した終端状態にする＝「毎回帯が出ては消える」を防ぐ）。
  const [pageDeleted, setPageDeleted] = useState(false)
  // 本文保存が同時に2本走らないようにする。「次に送る内容」は pendingBodyRef が
  // 一元的に持つ(二重管理を避ける)ので、ここでは「今まさに通信中か」だけを持つ。
  const savingRef = useRef(false)
  // savingRef が true の間に新しい編集が来たか。通信が終わったら、これが立っていた
  // ときだけ続けて送る（保存に失敗して pendingBodyRef を「戻した」だけのケースまで
  // 拾ってしまうと、同じ内容を無限に送り直しかねないため区別する）。
  const pendingDuringSaveRef = useRef(false)
  // いま通信中の保存。flushPendingSave はこれを待ってから残りを送る（待たないと、通信中に
  // 閉じたときに結果＝競合を知らないまま閉じ、書いた分が黙って消える）
  const inFlightRef = useRef<Promise<void> | null>(null)
  // ページを切り替えるたびに1つ進む「世代」。保存(savePendingBody)・最新を読み込む・
  // 版の復元は開始時に世代を掴み、await の後(送信結果が返った後・見せかけの競合の確認後・
  // 再送の後)ごとに pageEpochRef.current と一致するかを確かめてから共有の ref/state を書く。
  // 一致しなければ「もう見ていないページの結果」として何も書かずに捨てる
  // （保存の通信中にページを切り替えると、開いた先に前のページの基準・本文・競合状態が
  // 書き込まれてしまう事故を防ぐ）。
  const pageEpochRef = useRef(0)
  // 「最新を読み込む」・版の復元で1つ進める。エディタの key に含め、再マウントさせて
  // initialContent を読み直させる（本体は onChange の度に作り直さない）。ページを
  // 切り替えても 0 に戻さない: ページの id が変わればどのみち key は変わるため
  // リセットは不要で、逆に 0 へ戻すと「まだ前のページ(A)の本文のまま」の瞬間に key が
  // (新ページB.id-0) に変わって A の本文で B のエディタが作り直され、B を開いた直後に
  // A の本文で保存が走ってしまう（開いた直後の別ページに偽の競合帯が出る事故の元）。
  const [editorReloadToken, setEditorReloadToken] = useState(0)
  /**
   * 同時編集の状態。保存の判断は打つたび・タイマーの中で行うので、描き直しを待たずに
   * 読める ref に置く
   */
  const collabRef = useRef<WikiCollabState>(NO_COLLAB)
  const editorApiRef = useRef<WikiEditorApi | null>(null)
  /**
   * いま開いているページ。undefined は「まだ誰も決めていない」（受け付けを絞らない）、
   * null は「離れた直後で、どのページ宛ても受け付けない」。
   * 同時編集では相手の入力でも onChange が出るので、離れたあとも画面に残っている
   * 前のページのエディタから変更が届く。受け付けると、前のページの本文を次のページの
   * 基準で送り、開いた直後のページに偽の競合の帯が出る
   */
  const activePageIdRef = useRef<string | null | undefined>(undefined)
  /** 「最新を読み込む」の最中か。そのあいだに打った分は、読み直したあとに古い基準で送らない */
  const reloadingRef = useRef(false)
  /** 追記を差し込めずにやり直した回数 */
  const appendRetryCountRef = useRef(0)

  /** 同時編集中に、部屋の誰かが保存した分か（それなら競合ではない。中身は器で合流済み） */
  const savedInRoom = (fresh: WikiBodyBaseline): boolean => {
    const room = collabRef.current
    if (!room.active || !room.meta) return false
    const saved = readSavedState(room.meta)
    return saved.savedAt === fresh.updated_at && saved.savedHash === wikiContentHash(fresh.body)
  }

  /** 保存が通ったことを部屋に残す。次の書記はここから基準を引き継ぐ */
  const noteSavedInRoom = (updatedAt: string, body: string) => {
    const meta = collabRef.current.meta
    if (meta) writeSavedState(meta, { savedAt: updatedAt, savedHash: wikiContentHash(body) })
  }

  /** 待っている自動保存を止め、まだ送っていない書きかけを捨てる */
  const cancelPendingSave = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (savedTimerRef.current) { clearTimeout(savedTimerRef.current); savedTimerRef.current = null }
    pendingBodyRef.current = null
  }, [])

  const markConflict = useCallback(() => {
    conflictRef.current = true
    setConflict(true)
  }, [])

  const markDeleted = useCallback(() => {
    conflictRef.current = true
    setConflict(true)
    setPageDeleted(true)
  }, [])

  /**
   * サーバーにある状態を保存の基準にする。開いたとき・属性を変えたとき・版を戻したときに呼ぶ。
   * `content: true` なら「書きかけをコピー」の中身もそれに揃える（エディタを作り直すとき）
   */
  const setBaseline = useCallback((page: WikiBodyBaseline | null, options?: { content?: boolean }) => {
    if (page?.id) activePageIdRef.current = page.id
    baseUpdatedAtRef.current = page?.updated_at ?? null
    knownServerBodyRef.current = page?.body ?? null
    if (options?.content) currentContentRef.current = page?.body ?? ''
  }, [])

  /**
   * 待っている中身を今すぐ保存する。何も待っていなければ何もしない。
   * 本文保存は基準(baseUpdatedAtRef)を渡す楽観ロック付き — 渡さないと、画面を移る直前の
   * 保存(flushPendingSave経由)だけ楽観ロックを素通りしてしまう。0行(WikiConflictError)
   * なら、まず見せかけの競合(本文は同じ・他の更新でupdated_atだけ進んだ)かどうかを確かめ、
   * 見せかけなら基準を差し替えて1回だけ内部でやり直す。本当の競合・削除済みは帯を出し、
   * 例外を投げて呼び出し側を止める。特に flushPendingSave 経由(本文中のリンクでの画面
   * 移動)では、ここで例外を投げることで移動そのものを止める(useInAppLinkNavigation が
   * catch して移動しない設計になっている)。移ってしまうと帯を見せられないまま書きかけが
   * 失われるため、安全側に倒す。
   * 保存できなかったとき（本当の競合以外の失敗）は中身を戻して例外を投げる。
   * savingRef で同時に2本走らないようにする（同時に複数箇所から呼ばれても直列化する）。
   * pageEpochRef で「もう見ていないページ」の結果を書かないようにする。
   */
  const savePendingBody = useCallback(async (): Promise<void> => {
    if (savingRef.current) {
      // 既に別の保存が通信中。今まさに送るべき新しい書きかけ(pendingBodyRef)が実際に
      // あるときだけ「通信が終わったら続けて送る」の印を立てる。ページ切り替え時の
      // 「前のページ宛てに流し切る」呼び出しのように、送るものが無い(pendingBodyRef が
      // 既に空)状態でここへ来ることもあるため、無条件に印を立てない
      // （そうしないと、次のページの save が「新しい編集があった」と誤認して、
      // 前のページの内容や基準を巻き込んだまま再送してしまう）。
      if (pendingBodyRef.current) pendingDuringSaveRef.current = true
      return
    }
    if (conflictRef.current) return
    const pending = pendingBodyRef.current
    if (!pending) return
    pendingBodyRef.current = null
    // もう開いていないページ宛ての書きかけは送らない（開いている別のページの基準で送ることになる）
    if (activePageIdRef.current !== undefined && pending.pageId !== activePageIdRef.current) return
    const { pageId, body: content } = pending
    const epoch = pageEpochRef.current
    savingRef.current = true
    setSaveStatus('saving')

    const run = (async () => {
      try {
        const base = baseUpdatedAtRef.current ?? undefined
        try {
          const result = await updatePage(pageId, { body: content }, base)
          if (pageEpochRef.current !== epoch) return
          if (result.updatedAt === null) {
            // baseUpdatedAt を渡した保存で null が返ることは無いはずだが、型どおり有り得る
            // ものとして扱う。基準(baseUpdatedAtRef)を null で壊すと、以後の保存が
            // 楽観ロックの条件無しで送られてしまう（黙って上書き許可に戻る）ため、
            // 基準には触れず異常として終える。
            pendingBodyRef.current = pending
            setSaveStatus('idle')
            toast.error('保存できませんでした。通信の状態を確かめてください')
            throw new Error('保存に失敗しました（基準を確認できませんでした）')
          }
          baseUpdatedAtRef.current = result.updatedAt
          knownServerBodyRef.current = content
          noteSavedInRoom(result.updatedAt, content)
          setSaveStatus('saved')
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
          savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
          return
        } catch (err) {
          if (pageEpochRef.current !== epoch) return
          if (!(err instanceof WikiConflictError)) {
            pendingBodyRef.current = pending
            setSaveStatus('idle')
            toast.error('保存できませんでした。通信の状態を確かめてください')
            throw err
          }
          // WikiConflictError: 0行だった＝基準の updated_at がズレていた。まず見せかけの
          // 競合（他の人がタイトル等だけ変え、本文は変わっていない）かどうかを確かめる。
        }

        const fresh = await fetchPage(pageId)
        if (pageEpochRef.current !== epoch) return
        if (fresh === null) {
          // ページ自体が既に削除されていた（0行の原因は競合とは限らない）
          conflictRef.current = true
          setConflict(true)
          setPageDeleted(true)
          setSaveStatus('idle')
          throw new WikiConflictError('このページは見つかりませんでした')
        }
        if (canonicalizeWikiBody(fresh.body) === canonicalizeWikiBody(content)) {
          // 誰かが（部屋の別の人・閉じる直前の書記など）同じ中身を先に保存していた。
          // 送るまでもないので、基準をサーバーに合わせて終える
          baseUpdatedAtRef.current = fresh.updated_at
          knownServerBodyRef.current = fresh.body
          noteSavedInRoom(fresh.updated_at, content)
          setSaveStatus('idle')
          return
        }
        if (savedInRoom(fresh)) {
          // 同時編集中、部屋の中の人が保存した分だった。中身は器で全員に届いているので、
          // 基準を差し替えて書き直せばよい（下の「本文は同じ」と同じ道を通す）
          knownServerBodyRef.current = fresh.body
        } else if (fresh.body !== knownServerBodyRef.current) {
          // 仕様の確定で末尾にブロックが足されただけなら、書いている画面の末尾へ差し込む。
          // 差し込みはふつうの編集として届くので、直後の onChange から保存が続く
          // （同時編集中は書記だけがここへ来て、差し込んだ分は部屋の全員に届く）
          const appended = wikiAppendedBlocks(knownServerBodyRef.current, fresh.body)
          const applied = appended ? (editorApiRef.current?.appendBlocks(appended) ?? 'busy') : null
          if (applied === 'applied') {
            appendRetryCountRef.current = 0
            knownServerBodyRef.current = fresh.body
            baseUpdatedAtRef.current = fresh.updated_at
            setSaveStatus('idle')
            toast.success('ほかから追記された分を取り込みました')
            return
          }
          // 変換中・読み取り専用など一時的な事情なら、帯を出さずに少し待ってやり直す
          const attempt = appendRetryCountRef.current
          if (applied === 'busy' && attempt < APPEND_RETRY_DELAYS_MS.length) {
            appendRetryCountRef.current = attempt + 1
            pendingBodyRef.current = { pageId, body: currentContentRef.current }
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
            saveTimerRef.current = setTimeout(() => {
              saveTimerRef.current = null
              void savePendingBodyRef.current().catch(() => {})
            }, APPEND_RETRY_DELAYS_MS[attempt])
            setSaveStatus('idle')
            return
          }
          appendRetryCountRef.current = 0
          // 本文が本当に違う（本当の競合）
          conflictRef.current = true
          setConflict(true)
          setSaveStatus('idle')
          throw new WikiConflictError()
        }
        // 本文は同じ → 基準だけ差し替えて1回だけ保存をやり直す
        baseUpdatedAtRef.current = fresh.updated_at
        // 読み直している間に競合が確定していないか、送る直前にもう一度確かめる
        if (conflictRef.current) {
          setSaveStatus('idle')
          throw new WikiConflictError()
        }
        try {
          const retryResult = await updatePage(pageId, { body: content }, fresh.updated_at)
          if (pageEpochRef.current !== epoch) return
          if (retryResult.updatedAt === null) {
            pendingBodyRef.current = pending
            setSaveStatus('idle')
            toast.error('保存できませんでした。通信の状態を確かめてください')
            throw new Error('保存に失敗しました（基準を確認できませんでした）')
          }
          baseUpdatedAtRef.current = retryResult.updatedAt
          knownServerBodyRef.current = content
          noteSavedInRoom(retryResult.updatedAt, content)
          setSaveStatus('saved')
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
          savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000)
        } catch (retryErr) {
          if (pageEpochRef.current !== epoch) return
          if (retryErr instanceof WikiConflictError) {
            conflictRef.current = true
            setConflict(true)
          }
          setSaveStatus('idle')
          throw retryErr
        }
      } finally {
        savingRef.current = false
        const hasNewEdit = pendingDuringSaveRef.current
        pendingDuringSaveRef.current = false
        // 通信中に新しい書きかけが来ていたら、その最新の内容で続けて送る（競合が確定して
        // いなければ）。保存に失敗して pendingBodyRef を「戻した」だけのとき(hasNewEditが
        // 立っていないとき)は、ここで送り直さない（同じ内容を無限に送り直さないため）。
        if (hasNewEdit && !conflictRef.current) {
          pendingBodyRef.current = { pageId, body: currentContentRef.current }
          // 続けて送る分の失敗は、それを待つ flushPendingSave（inFlightRef 経由）が受け取る
          savePendingBody().catch(() => {})
        }
      }
    })()
    inFlightRef.current = run
    try {
      await run
    } finally {
      // 続けて送った分が入れ替わっていたら、そちらを残す
      if (inFlightRef.current === run) inFlightRef.current = null
    }
  }, [updatePage, fetchPage])

  /**
   * ページの切り替え effect などから最新の savePendingBody を呼ぶための入れ物。
   * 依存に直接入れると、updatePage の参照が変わるだけで切り替えの effect が走り直り、
   * 全画面表示などがリセットされてしまう
   */
  const savePendingBodyRef = useRef(savePendingBody)
  useEffect(() => {
    savePendingBodyRef.current = savePendingBody
  }, [savePendingBody])

  /**
   * いま開いているページから離れる（別のページへ切り替える・閉じる）。
   * 捨てると最後の一手が消えるので、前のページ宛てに保存しきる。世代はこの直後に
   * 進めるので、この呼び出し自体は「まだ現役」の世代のうちに送信され、await の
   * 先(基準・本文の書き込み)は世代のズレで自然に捨てられる(新しい画面を汚さない)。
   * 競合状態は前のページのものなので必ずリセットする（前のページの取り違えを防ぐ）
   */
  const leavePage = useCallback(() => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null }
    if (savedTimerRef.current) { clearTimeout(savedTimerRef.current); savedTimerRef.current = null }
    // 同時編集中の書記でない人は、閉じるときも自分では保存しない。中身は器で書記に届いていて、
    // 書記が保存する。ここで送ると、その保存の記録が部屋に届かないまま（閉じたあとなので）
    // 残った書記の次の保存が弾かれ、偽の競合の帯が出て部屋全体の保存が止まる
    void savePendingBodyRef.current().catch(() => {})
    // 以後、次のページの基準が決まるまでは、どのページ宛ての変更も受け付けない
    activePageIdRef.current = null
    pageEpochRef.current += 1
    setSaveStatus('idle')
    conflictRef.current = false
    setConflict(false)
    setPageDeleted(false)
  }, [])

  /** エディタの onChange。pageId は、いま開いているページ */
  const handleChange = useCallback((pageId: string, content: string) => {
    // 「書きかけをコピー」が常に今の内容を返せるよう、保存の成否に関わらず先に控える
    // もう開いていないページのエディタから届いた変更は受け付けない（控えも上書きしない）。
    // 同時編集では、相手の入力でも onChange が出る
    if (activePageIdRef.current !== undefined && pageId !== activePageIdRef.current) return
    currentContentRef.current = content
    // 「最新を読み込む」の最中に打った分は保存しない（読み直したあとの新しい基準で、古い中身を送らない）
    if (reloadingRef.current) return

    // 競合中は新しい保存を投げない（編集自体は止めない・帯の「最新を読み込む」を待つ）。
    // state(conflict) ではなく ref を見る — setConflict は再描画を経て closure に反映される
    // ため、その間の古い closure から呼ばれた場合に「まだ競合していない」と誤判定する。
    if (conflictRef.current) return

    // 同時編集中に列へ保存するのは書記1人だけ。全員が保存すると、更新時刻の突き合わせで
    // 互いを弾き合う。書いた内容は器を通じて全員に届いているので、取りこぼしは起きない
    if (collabRef.current.active && !collabRef.current.isScribe) {
      pendingBodyRef.current = null
      return
    }

    // Clear existing timers
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current)

    // 開いたとき（または直前の保存）と同じ内容なら、保存もタイマーも張らない。BlockNote は
    // 初期表示直後に一度 onChange を呼ぶため、これが無いとページを開くだけで保存が走り、
    // 版の履歴が無駄に増える（議事録の baselineRef 比較と同じ考え方）。生の文字列そのまま
    // ではなく正規化(canonicalizeWikiBody)して比べる — DB側で組み立てられた本文は
    // キー順・空白がクライアントの JSON.stringify と一致しないことがあるため。
    if (canonicalizeWikiBody(content) === canonicalizeWikiBody(knownServerBodyRef.current)) {
      pendingBodyRef.current = null
      // 打った直後に元へ戻すと(Ctrl+Zなど)ここに来るが、直前に setSaveStatus('saving')
      // 済みのことがあるため、ここで idle に戻さないと「保存中...」の表示が永久に残る。
      setSaveStatus('idle')
      return
    }

    // 待ち時間のあいだに画面を移るときは、この中身を保存しきってから移る（flushPendingSave）
    pendingBodyRef.current = { pageId, body: content }
    // 既に別の保存が通信中なら、その保存の finally が拾えるよう印を立てる
    if (savingRef.current) pendingDuringSaveRef.current = true
    setSaveStatus('saving')

    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null
      // 待っているあいだに書記を降りていることがある（タブを切り替えると交代する）
      if (collabRef.current.active && !collabRef.current.isScribe) {
        pendingBodyRef.current = null
        return
      }
      // 自動保存の失敗は savePendingBody がトーストで知らせる
      void savePendingBodyRef.current().catch(() => {})
    }, 1500)
  }, [])

  const copyDraft = useCallback(async () => {
    try {
      // 本文はもともと BlockNote の JSON 文字列（WikiEditor の onChange が
      // JSON.stringify(editor.document) を渡す）。読みやすい Markdown 等へ変換すると
      // 貼り戻せなくなるため、変換せずそのままクリップボードへ入れる
      // （帯の文面で「そのままでは貼り戻せない形式」と断っている）。
      await navigator.clipboard.writeText(currentContentRef.current)
      toast.success('書きかけをコピーしました')
    } catch {
      toast.error('コピーできませんでした')
    }
  }, [])

  /**
   * 帯の「最新を読み込む」。読み直したページを返す（呼び出し側が表示を差し替える）。
   * 削除されていたら null、読み直している間に別のページへ切り替わっていたら undefined
   */
  const reloadLatest = useCallback(async (
    pageId: string,
    /**
     * 読み直したページを画面に反映する。エディタを作り直す合図より先に、同じ流れの中で呼ぶ
     * （あとから反映すると、間に描画が挟まったときに古い本文でエディタが作り直され、
     * 次の入力で古い本文を新しい基準で保存して相手の変更を黙って消す）
     */
    onFresh?: (fresh: WikiPage) => void
  ): Promise<WikiPage | null | undefined> => {
    // savePendingBody と同じ世代ガード。fetchPage の間にページを切り替えられても
    // 気づけるようにする。切り替え後は、読み直した「前のページ」の内容を「今見ている
    // 別のページ」の画面(表示・基準・本文・競合状態・エディタの作り直し)へ書かない。
    const epoch = pageEpochRef.current
    // 保留中の（まだ発火していない）自動保存があれば必ず止める。止めないと、
    // この後で基準を最新に差し替えたあとにこのタイマーが発火し、読み込む前の古い
    // 書きかけが新しい基準で保存に成功して相手の最新の内容を黙って上書きしてしまう。
    // （すでに通信中の保存自体は取り消せない。楽観ロックが最後の砦になる）
    cancelPendingSave()

    reloadingRef.current = true
    let fresh: WikiPage | null
    try {
      fresh = await fetchPage(pageId)
    } finally {
      reloadingRef.current = false
    }
    // 読み直しているあいだに張られた保存の予約も止める（読み直す前の中身で送らない）
    cancelPendingSave()
    if (pageEpochRef.current !== epoch) return undefined
    if (fresh === null) {
      // 読み直した先でページ自体が無くなっていた（削除された）。帯は下ろさず
      // 文面だけ切り替える。conflict はそのまま true のままにする（安定した終端状態にし、
      // 「読み直すたびに帯が出ては消える」を防ぐ）。
      setPageDeleted(true)
      setSaveStatus('idle')
      return null
    }
    onFresh?.(fresh)
    setBaseline(fresh, { content: true })
    conflictRef.current = false
    setConflict(false)
    setPageDeleted(false)
    setSaveStatus('idle')
    // 同時編集中は、エディタを作り直さずに中身を差し替える。作り直すと部屋に入り直し、
    // まだ古い中身を持っている相手から古い本文を受け取ってしまう。差し替えはふつうの
    // 編集として部屋の全員に届く
    if (collabRef.current.active && editorApiRef.current?.replaceContent(fresh.body)) return fresh
    // key に含めてエディタを作り直し、読み直した内容を initialContent として反映する
    setEditorReloadToken(t => t + 1)
    return fresh
  }, [fetchPage, cancelPendingSave, setBaseline])

  /**
   * 画面を移る前に呼ぶ。1.5秒の待ちの途中で移ると最後の一手が保存されないまま消えるので、
   * ここで確定させる。savePendingBody が例外を投げたらそのまま伝える
   * （useInAppLinkNavigation 側が catch して画面を移らない）。
   */
  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    // 通信中の保存があれば、終わるまで待つ（失敗・競合ならそのまま投げて呼び出し側を止める）。
    // 終わった直後に続けて送る分が始まることがあるので、無くなるまで待つ
    while (inFlightRef.current) await inFlightRef.current
    await savePendingBody()
  }, [savePendingBody])

  /** 同時編集の状態を受け取る（本文を描く部品が、変わるたびに呼ぶ） */
  const setCollab = useCallback((next: WikiCollabState | null) => {
    collabRef.current = next ?? NO_COLLAB
  }, [])

  const registerEditorApi = useCallback((api: WikiEditorApi | null) => {
    editorApiRef.current = api
  }, [])

  const isCollabActive = useCallback(() => collabRef.current.active, [])

  /**
   * 生きているエディタの中身を差し替える（版の復元など）。同時編集中は部屋の全員に届く。
   * 差し替えられなければ false（呼び出し側はエディタを作り直す）
   */
  const replaceEditorContent = useCallback((body: string | null) => {
    return editorApiRef.current?.replaceContent(body) ?? false
  }, [])

  /**
   * 書記を引き継いだとき（前の書記が画面を閉じた・裏のタブに回った）。
   *
   * 自分が開いたときの古い基準のまま列へ書きに行くと必ず弾かれるので、**引き継いだ
   * 時点の列を読み直して**基準を取り直す。そのうえで、いま器にある内容が列と違えば
   * 1回保存する（前の書記が抜けた瞬間の書きかけを取りこぼさないため）。
   * まだ誰も保存していない部屋なら、自分が最初の1人なので何もしない。
   */
  const takeOverAsScribe = useCallback(async (pageId: string, options?: { force?: boolean }) => {
    const meta = collabRef.current.meta
    if (!meta) return
    // 部屋に保存の記録が無くても、一度は書記でなかった人（force）は読み直す。前の書記が
    // 閉じる直前にした保存は、部屋の記録に残らない（閉じたあとなので届かない）
    if (!options?.force && !readSavedState(meta).savedAt) return
    const epoch = pageEpochRef.current
    let fresh: WikiPage | null = null
    try {
      fresh = await fetchPage(pageId)
    } catch {
      // 引き継ぎに失敗しても書けなくはしない。次の保存で競合の帯に倒れる
      return
    }
    if (!fresh || pageEpochRef.current !== epoch || conflictRef.current) return
    baseUpdatedAtRef.current = fresh.updated_at
    knownServerBodyRef.current = fresh.body
    const current = currentContentRef.current
    if (current.trim() === '') return
    if (canonicalizeWikiBody(current) === canonicalizeWikiBody(fresh.body)) return
    pendingBodyRef.current = { pageId, body: current }
    await savePendingBodyRef.current().catch(() => {})
  }, [fetchPage])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const getEpoch = useCallback(() => pageEpochRef.current, [])
  const getBaseUpdatedAt = useCallback(() => baseUpdatedAtRef.current, [])
  const reloadEditor = useCallback(() => setEditorReloadToken(t => t + 1), [])

  // 1つにまとめて返す。入れ物は保存の状態（saveStatus など）が変わるたび＝打つたびに
  // 作り直される。effect の依存には入れ物ではなく、中の関数（変わらない）を入れること
  return useMemo(
    () => ({
      saveStatus,
      conflict,
      pageDeleted,
      editorReloadToken,
      /** 版の復元など、いまの世代のうちに終わったかを確かめる非同期処理のために */
      getEpoch,
      /** 楽観ロックの基準（版の復元で渡す） */
      getBaseUpdatedAt,
      reloadEditor,
      setCollab,
      registerEditorApi,
      isCollabActive,
      replaceEditorContent,
      takeOverAsScribe,
      setBaseline,
      cancelPendingSave,
      markConflict,
      markDeleted,
      leavePage,
      handleChange,
      copyDraft,
      reloadLatest,
      flushPendingSave,
    }),
    [
      saveStatus,
      conflict,
      pageDeleted,
      editorReloadToken,
      getEpoch,
      getBaseUpdatedAt,
      reloadEditor,
      setCollab,
      registerEditorApi,
      isCollabActive,
      replaceEditorContent,
      takeOverAsScribe,
      setBaseline,
      cancelPendingSave,
      markConflict,
      markDeleted,
      leavePage,
      handleChange,
      copyDraft,
      reloadLatest,
      flushPendingSave,
    ]
  )
}
