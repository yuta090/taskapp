'use client'

import { useCallback, useEffect, useMemo, useRef, type FocusEvent as ReactFocusEvent } from 'react'
import { PencilSimple } from '@phosphor-icons/react'
import { WikiEditorDynamic } from '@/components/wiki/WikiEditorDynamic'
import type { WikiEditorHandle } from '@/components/wiki/WikiEditor'
import { EditorLoadingFallback } from '@/components/editor/EditorLoadingFallback'
import { useMinutesCollab } from '@/lib/hooks/useMinutesCollab'
import { WIKI_TOPIC_PREFIX } from '@/lib/hooks/useMinutesPresence'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { isCollabEnabledForOrg } from '@/lib/collab/flag'
import { degradeMessage, displayNameOf, formatEditingMessage } from '@/lib/collab/messages'
import type { WikiCollabState, WikiEditorApi } from '@/lib/wiki/useWikiBodySave'

/**
 * Wiki の本文は JSON なので、同じ中身でも議事録の Markdown の数倍の長さになる。
 * 遅れて入った人へ送る量の上限（1通 150万字）に余裕を残せる長さにする
 */
const WIKI_MAX_COLLAB_LENGTH = 400_000

/** 保存のフック（useWikiBodySave）のうち、この部品が使うところ */
interface WikiBodySaveBridge {
  handleChange: (pageId: string, content: string) => void
  setCollab: (state: WikiCollabState | null) => void
  registerEditorApi: (api: WikiEditorApi | null) => void
  takeOverAsScribe: (pageId: string, options?: { force?: boolean }) => Promise<void>
}

interface WikiBodyEditorProps {
  orgId: string
  spaceId: string
  pageId: string
  /** 開いたときの本文（列の値）。種まきにも使う */
  initialBody: string | null
  /** その本文を読んだときの更新時刻。種が2つ入ったときに、どちらが新しいかを決める */
  basisUpdatedAt: string
  canEdit: boolean
  bodySave: WikiBodySaveBridge
  /** 本文が二重になって直しきれなかったとき、列から読み直す（エディタを作り直す） */
  onRequestReload: () => void
  onBeforeNavigate?: () => void | Promise<void>
  noteAuthorName?: string
  poll?: {
    wikiPageId: string
    currentUserId: string | null
    nameOf: (userId: string) => string
  }
}

/**
 * Wiki の本文を描く。Wiki 画面と、議事録の上に重ねた Wiki の両方がこれを使う
 * （片方だけ同時編集にすると、もう片方から書いた人だけ競合の帯が出続けるため）。
 *
 * 同時編集の仕組みは議事録と同じもの（`useMinutesCollab`）を、Wiki のページの部屋
 * （`wiki-page:<ページID>`）で使う。使う組織の切り替えも議事録と同じ設定
 * （`NEXT_PUBLIC_COLLAB_MINUTES_ORG_IDS`）。保存は `useWikiBodySave` が受け持ち、
 * ここは「いま書記か」を渡すだけ。
 *
 * **ページが替わったら作り直すこと**（呼び出し側が key にページの ID を入れる）。
 * 部屋はページごとで、同時編集を使うかどうかも開いたときに決める。
 */
export function WikiBodyEditor({
  orgId,
  spaceId,
  pageId,
  initialBody,
  basisUpdatedAt,
  canEdit,
  bodySave,
  onRequestReload,
  onBeforeNavigate,
  noteAuthorName,
  poll,
}: WikiBodyEditorProps) {
  const { user } = useCurrentUser()
  const selfUserId = user?.id ?? ''
  const selfName = displayNameOf(user)
  const collabAllowed = isCollabEnabledForOrg(orgId)

  const {
    others,
    setEditing,
    active,
    isScribe,
    fragment,
    awareness,
    meta,
    isApplyingRemote,
    synced,
    colorIndex,
    pending,
    solo,
    degradedReason,
    registerSeeder,
  } = useMinutesCollab({
    meetingId: pageId,
    topicPrefix: WIKI_TOPIC_PREFIX,
    // 在席（「書いています」）も同時編集を使う組織だけ。Wiki は議事録よりずっと多く開かれるので、
    // 使わない組織にまで Realtime のつなぎを増やさない
    presenceEnabled: canEdit && !!selfUserId && collabAllowed,
    self: { userId: selfUserId, name: selfName },
    collabAllowed,
    initialMarkdown: initialBody ?? '',
    maxLength: WIKI_MAX_COLLAB_LENGTH,
  })

  // 保存の判断は打つたびに行うので、描き直しのたびに最新を渡す（ref への書き込みだけ）。
  // 外れるときに消さないのは、閉じた直後に親が呼ぶ leavePage が、このページの状態で
  // 「書記でなくても、まだ部屋で保存されていない分を送る」を判断するため（子の後始末が先に走る）。
  // 次のページを開けば、その描画で上書きされる
  bodySave.setCollab({ active, isScribe, meta })

  /**
   * エディタが載ったら、保存のフックに差し込み口を渡し、種をまく係も登録する。
   * 器に本文を入れられるのは ProseMirror のスキーマを持つエディタだけなので、合流はここから始まる
   */
  const registerEditorApi = bodySave.registerEditorApi
  const registerApi = useCallback(
    (api: WikiEditorHandle | null) => {
      registerEditorApi(api)
      registerSeeder(
        api ? (doc) => ({ seedHash: api.seedCollabDoc(doc, initialBody), basis: basisUpdatedAt }) : null
      )
    },
    [registerEditorApi, registerSeeder, initialBody, basisUpdatedAt]
  )

  /** 書記を引き継いだら、列を読み直して基準を取り直す（中身は useWikiBodySave） */
  const takeOverAsScribe = bodySave.takeOverAsScribe
  const wasScribeRef = useRef(false)
  /**
   * 本文を持ったまま書記でなかったことがあるか。あるなら、書記になったときは必ず列を読み直す
   * （前の書記が閉じる直前にした保存は部屋の記録に残らないので、記録の有無では決められない）
   */
  const everFollowerRef = useRef(false)
  useEffect(() => {
    if (!active || !isScribe) {
      if (active && synced) everFollowerRef.current = true
      wasScribeRef.current = false
      return
    }
    if (wasScribeRef.current) return
    wasScribeRef.current = true
    void takeOverAsScribe(pageId, { force: everFollowerRef.current })
  }, [active, isScribe, synced, pageId, takeOverAsScribe])

  /** 本文が二重になって直しきれなかった。保存せず、列から読み直す（1回だけ） */
  const reloadedForDuplicateRef = useRef(false)
  useEffect(() => {
    if (degradedReason !== 'duplicate-seed' || reloadedForDuplicateRef.current) return
    reloadedForDuplicateRef.current = true
    onRequestReload()
  }, [degradedReason, onRequestReload])

  const handleChange = bodySave.handleChange
  const lastContentRef = useRef<string | null>(null)
  const handleEditorChange = useCallback(
    (content: string) => {
      // 本文が実際に動いたときだけ「書いています」にする。相手の文字が流れ込んだ分では立てない
      if (lastContentRef.current !== null && content !== lastContentRef.current && !isApplyingRemote()) {
        setEditing(true)
      }
      lastContentRef.current = content
      handleChange(pageId, content)
    },
    [handleChange, pageId, isApplyingRemote, setEditing]
  )

  /** エディタ領域の外へカーソルが出たときだけ「書いています」を下ろす */
  const handleBlur = useCallback(
    (e: ReactFocusEvent<HTMLDivElement>) => {
      const next = e.relatedTarget as Node | null
      if (next && e.currentTarget.contains(next)) return
      setEditing(false)
    },
    [setEditing]
  )

  // 器の用意を待つあいだに、エディタのチャンクも取りに行っておく（載せるのは用意のあと）。
  // 待ってから取りに行くと、初めて開いたときにチャンク1往復ぶん本文が遅れる
  useEffect(() => {
    if (pending) void import('./WikiEditor')
  }, [pending])

  /** 同じ参照を保つ（毎回作り直すと、在席が動くたびにエディタごと描き直す） */
  const collaboration = useMemo(
    () => (fragment && awareness ? { fragment, awareness, userName: selfName, colorIndex } : undefined),
    [fragment, awareness, selfName, colorIndex]
  )

  const editingPeers = others.filter((peer) => peer.editing)
  const degradedNotice = degradedReason ? degradeMessage(degradedReason, 'ページ') : null

  return (
    <>
      {/* 同時編集をやめて1人で書く形に戻ったときの知らせ。編集は止めない */}
      {degradedNotice && (
        <div
          data-testid="wiki-collab-degraded-notice"
          data-print-hide
          className="mb-3 px-3 py-2 rounded bg-gray-50 border border-gray-100"
        >
          <p className="text-xs text-gray-500">{degradedNotice}</p>
        </div>
      )}
      {editingPeers.length > 0 && (
        <div
          data-testid="wiki-presence-banner"
          data-print-hide
          className="mb-3 px-3 py-2 rounded bg-indigo-50 border border-gray-100"
        >
          <p className="text-xs text-indigo-ink flex items-center gap-1.5">
            <PencilSimple className="text-sm flex-shrink-0" />
            {formatEditingMessage(editingPeers)}
          </p>
        </div>
      )}
      <div onFocus={() => setEditing(true)} onBlur={handleBlur}>
        {/* 器の用意が終わるまで・本文が器に届くまではスケルトンを出す。届く前のエディタは空なので
            （「開いたら本文が消えた」に見える）。エディタはスキーマを貸すために載せたまま隠しておく */}
        {(pending || !synced) && <EditorLoadingFallback />}
        {pending ? null : (
          <div className={synced ? undefined : 'hidden'}>
            <WikiEditorDynamic
              // 器につながずに載せ替えるときは作り直す。つないだままだと、空の器に打った1文字で本文が消える
              key={solo ? 'solo' : 'collab'}
              initialContent={collaboration ? undefined : initialBody || undefined}
              onChange={canEdit ? handleEditorChange : undefined}
              onBeforeNavigate={onBeforeNavigate}
              editable={canEdit && synced}
              orgId={orgId}
              spaceId={spaceId}
              currentPageId={pageId}
              noteAuthorName={noteAuthorName}
              poll={poll}
              collaboration={collaboration}
              registerApi={registerApi}
            />
          </div>
        )}
      </div>
    </>
  )
}
