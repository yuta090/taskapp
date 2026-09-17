'use client'

/**
 * 議事録の同時編集を組み立てる。
 *
 * 在席（「〇〇さんが書いています」）と同じチャネルに相乗りするので、在席のフックを
 * この中から呼ぶ（同じ名前のチャネルに2回は入れない）。同時編集を使わない組織では
 * これまでどおり在席だけが動き、器（Y.Doc）も作らない。
 *
 * **合流の本体（`session.ts`）は使うときだけ読み込む。** 静かに import すると、
 * 会議ページを開いただけで yjs 一式が落ちてくる（同時編集を使わない組織でも）。
 *
 * 種まきには ProseMirror のスキーマが要るが、それはエディタが載ってからでないと
 * 取れない。順番はこうなる:
 *   器ができる → エディタを載せる（器を渡す）→ 種をまく係が登録される → 合流を始める
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { DegradeReason, MinutesCollabSession, MinutesSeeder } from '@/lib/collab/session'
import { colorIndexOf, electScribe, rankOf, type CollabPeer } from '@/lib/collab/scribe'
import type { CollabEvent, CollabHandlers, CollabMessage, CollabStatus, CollabTransport } from '@/lib/collab/transport'
import { useMinutesPresence, type MinutesPresencePeer } from './useMinutesPresence'

/** 同時に入れる人数の上限。超えた人は読めるが輪に入らない（COEDITING_SPEC 5.8） */
export const MAX_COLLAB_PEERS = 6
/** この文字数を超える議事録では同時編集を使わない（遅れて入った人へ送る量が大きすぎる） */
export const MAX_COLLAB_LENGTH = 100_000
/** デスクトップの下限。スマホは今までどおり1人用のエディタにする（UI_RULES と同じ `md`） */
const DESKTOP_MIN_WIDTH = 768

/**
 * いま同時編集に加われる画面か。スマホは今までどおり1人用のエディタにする。
 * **描画の途中では呼ばない**（幅を測るのは描画が終わったあと）。
 */
function isDesktopWidth(): boolean {
  if (typeof window === 'undefined') return true
  return window.innerWidth >= DESKTOP_MIN_WIDTH
}

/** このタブの見分け札を作る。同じ端末で並べて開いても必ず別の値になる */
function newTabId(): string {
  const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `tab-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

export interface UseMinutesCollabOptions {
  meetingId: string
  /** 在席を共有するか（書ける人だけ）。同時編集の可否とは別 */
  presenceEnabled: boolean
  self: { userId: string; name: string }
  /** この組織で同時編集を開いているか */
  collabAllowed: boolean
  /** 開いたときの本文。長さの判定に使う */
  initialMarkdown: string
  /** 部屋の誰かがタスク化した。列を読み直す（器の本文と列がずれたため） */
  onRoomReload?: () => void
}

export interface UseMinutesCollabResult {
  others: MinutesPresencePeer[]
  setEditing: (editing: boolean) => void
  /** 同時編集が生きているか（落ちたら false） */
  active: boolean
  /**
   * 器の用意がまだ終わっていない。true の間はエディタを載せない
   * （器を渡さずに載せると、あとから渡せない＝同時編集にならない）
   */
  pending: boolean
  /**
   * 1人で書く形か。同時編集を使わない・**本文が入る前に落ちた**ときに true。
   * このときエディタは器につながず、列の本文をそのまま載せる（今までどおりの形）。
   */
  solo: boolean
  /** 列へ保存する係か。同時編集を使っていないときは常に true（今までどおり全員が保存する） */
  isScribe: boolean
  /** BlockNote に渡すもの。使わないときは null */
  fragment: Y.XmlFragment | null
  awareness: Awareness | null
  /** 全員で共有する覚え書き（保存の基準） */
  meta: Y.Map<unknown> | null
  /** いま相手の更新を取り込んでいる最中か */
  isApplyingRemote: () => boolean
  /**
   * 本文が器に入ったか。入るまでエディタは空なので、呼び出し側は書けないようにする
   * （空のまま打つと、あとから届いた本文と混ざる）。同時編集を使わないときは常に true
   */
  synced: boolean
  /**
   * 自分のカーソルを何番の色で描くか。部屋の中で重ならないように割り当てる
   * （人ごとにハッシュで選ぶと、運が悪いと2人が同じ色になる）
   */
  colorIndex: number
  /** 1人で書く形へ落ちた理由。落ちていなければ null */
  degradedReason: DegradeReason | null
  /** エディタが載ったら、種をまく係を登録する（null で解除） */
  registerSeeder: (seeder: MinutesSeeder | null) => void
  /** タスク化のあとに、部屋のみんなへ「列を読み直して」と伝える */
  requestRoomReload: () => void
}

/** 在席のチャネルに乗せるための運び役。参加と切断は在席のフックが受け持つ */
interface ChannelTransport extends CollabTransport {
  deliver: (message: CollabMessage) => void
  setStatus: (status: CollabStatus) => void
  /** 実際の送り口を差し込む。チャネルにつながるまでは送らない */
  setSender: (send: ((event: CollabEvent, bytes: Uint8Array, to?: string) => void) | null) => void
}

function createChannelTransport(): ChannelTransport {
  let handlers: CollabHandlers | null = null
  let sender: ((event: CollabEvent, bytes: Uint8Array, to?: string) => void) | null = null
  /**
   * 最後に届いた状態。合流の本体は使うときだけ読み込むので、**つながる方が先になる**
   * ことがある。覚えておいて、始まった時点で渡し直さないと、つながった知らせを
   * 取りこぼして種まきも目録合わせも起きない（誰も書けない）。
   */
  let lastStatus: CollabStatus | null = null
  return {
    join(next) {
      handlers = next
      if (lastStatus) next.onStatus(lastStatus)
    },
    send(event, bytes, to) {
      sender?.(event, bytes, to)
    },
    leave() {
      handlers = null
    },
    deliver(message) {
      handlers?.onMessage(message)
    },
    setStatus(status) {
      lastStatus = status
      handlers?.onStatus(status)
    },
    setSender(next) {
      sender = next
    },
  }
}

export function useMinutesCollab({
  meetingId,
  presenceEnabled,
  self,
  collabAllowed,
  initialMarkdown,
  onRoomReload,
}: UseMinutesCollabOptions): UseMinutesCollabResult {
  // 使うかどうかは開いた時点で決め、途中で変えない（器の作り直しは本文の二重を招く）。
  // 画面の幅は描画の途中では見ない（effect で見る）ので、ここには入れない
  const [wanted] = useState(
    () => collabAllowed && presenceEnabled && !!self.userId && initialMarkdown.length <= MAX_COLLAB_LENGTH
  )

  /**
   * このタブの見分け札。**人ではなくタブで見分ける**のが要点。
   * 人ごとにすると、同じ人が並べて開いた2つのタブが互いを相手と見なさず、
   * どちらも保存しに行って弾き合う（＝競合の帯が出続ける）。
   * 値を作るのは描画のあと（effect）にする。描画の途中で作ると、同じ描画が
   * 2回走ったときに別の値になる。
   */
  const [tabId, setTabId] = useState('')
  const tabIdRef = useRef('')
  useEffect(() => {
    if (tabIdRef.current) return
    tabIdRef.current = newTabId()
    setTabId(tabIdRef.current)
  }, [])

  const [session, setSession] = useState<MinutesCollabSession | null>(null)
  /** 器を用意している途中か。用意しないと決めたら false になる */
  const [preparing, setPreparing] = useState(wanted)
  const [degradedReason, setDegradedReason] = useState<DegradeReason | null>(null)
  const [scribeId, setScribeId] = useState<string | null>(null)
  const [synced, setSynced] = useState(false)
  const [colorIndex, setColorIndex] = useState(0)
  /**
   * 色の番号は**一度決めたら変えない**。カーソルを描く部品は相手ごとに札を1回だけ
   * 作って使い回すので、あとから変えても相手の画面には届かない（`cursorColors.ts`）。
   */
  const colorIndexRef = useRef<number | null>(null)
  /** 落ちた時点で本文が入っていたか。入る前に落ちたら1人用のエディタへ載せ替える */
  const [soloFallback, setSoloFallback] = useState(false)

  const syncedRef = useRef(false)
  const selfUserIdRef = useRef(self.userId)
  /**
   * 1つ前の版の画面が部屋に居ると分かったか。
   * 器は使うときだけ読み込むので、**できる前に在席が届くことがある**。覚えておかないと、
   * あとからできた器が縮退しておらず、「自分ひとりだ」と見えて種をまいてしまう。
   */
  const peerOutdatedRef = useRef(false)
  /**
   * 最後に届いた部屋の顔ぶれ。器は使うときだけ読み込むので、**できる前に在席が
   * 届くことがある**。覚えておかないと、その顔ぶれが捨てられて器が「自分ひとりだ」と
   * 見え、先客が居るのに本文を作ってしまう（＝二重になる）。
   */
  const lastPeersRef = useRef<CollabPeer[]>([])
  const seederRef = useRef<MinutesSeeder | null>(null)
  const sessionRef = useRef<MinutesCollabSession | null>(null)
  const onRoomReloadRef = useRef(onRoomReload)
  const setCollabActiveRef = useRef<(active: boolean) => void>(() => {})
  const setCollabPresentRef = useRef<(present: boolean) => void>(() => {})
  const setCollabStateRef = useRef<(next: { active?: boolean; present?: boolean }) => void>(() => {})
  const setColorIndexRef = useRef<(index: number) => void>(() => {})

  const [transport] = useState(() => createChannelTransport())

  useEffect(() => {
    onRoomReloadRef.current = onRoomReload
  }, [onRoomReload])

  const handleDegrade = useCallback((reason: DegradeReason) => {
    setDegradedReason((prev) => prev ?? reason)
    // 本文が入る前に落ちたら、器を捨てて1人用のエディタに載せ替える。
    // そのまま器につないでおくと、**空のエディタに打った1文字で議事録が丸ごと消える**
    if (!syncedRef.current) setSoloFallback(true)
    // 落ちたことを在席で伝える。伝えないと、落ちた自分が書記に選ばれ続け、
    // 誰の書いた内容も列に残らなくなる（1通にまとめて送る）
    setCollabStateRef.current({ active: false, present: false })
  }, [])

  /**
   * 器を用意する。**effect の中で作って、片付けで壊す**のが要点。
   * 描画のたびに作ると、React の開発時の二重呼び出しで「壊したほうの器」が残り、
   * エディタが空の読み取り専用のまま固まる。
   */
  useEffect(() => {
    if (!wanted || !tabId) return
    // スマホは今までどおり1人用のエディタ（UI_RULES の `md` に合わせる）
    if (!isDesktopWidth()) {
      setPreparing(false)
      return
    }

    let cancelled = false
    let created: MinutesCollabSession | null = null
    void import('@/lib/collab/session')
      .then((module) => {
        if (cancelled) return
        created = new module.MinutesCollabSession({
          selfId: tabId,
          transport,
          onDegrade: handleDegrade,
          onSynced: () => {
            syncedRef.current = true
            setSynced(true)
            // 本文の入った器を持っていることを在席で名乗る。ここで初めて書記の
            // 候補になる。持っていないのに名乗ると、自分が書記に選ばれたまま
            // 誰の書いた内容も列に残らなくなる
            setCollabActiveRef.current(true)
          },
          onRoomReload: () => onRoomReloadRef.current?.(),
        })
        sessionRef.current = created
        // 器ができる前に受け取っていたものを、ここで当てる。当てないと、
        // 縮退していない器が「自分ひとりだ」と見えて種をまく
        created.setPeers(lastPeersRef.current)
        if (peerOutdatedRef.current) created.degrade('peer-outdated')
        // 顔ぶれを渡したあとに始める。逆にすると、始まった時点の顔ぶれが空になる
        if (seederRef.current && !created.isDegraded) {
          created.setSeeder(seederRef.current)
          created.start()
        }
        setSession(created)
        setPreparing(false)
      })
      .catch(() => {
        if (cancelled) return
        // 読み込めなければ同時編集は使わない（画面はこれまでどおり1人用で動く）。
        // 名乗りは下ろす。名乗ったままだと、ほかの人がこちらの返事を待って止まる
        setCollabPresentRef.current(false)
        setPreparing(false)
      })

    return () => {
      cancelled = true
      created?.destroy()
      if (sessionRef.current === created) sessionRef.current = null
      setSession(null)
    }
  }, [wanted, tabId, transport, handleDegrade])

  const collabWiring = useMemo(
    () =>
      wanted
        ? {
            onMessage: (message: CollabMessage) => transport.deliver(message),
            onPeers: (peers: CollabPeer[]) => {
              // 顔ぶれは先に渡しておく。降りる判断で先に返すと、取りこぼしたときに
              // 顔ぶれが空のまま＝「自分ひとりだ」と見えてしまう。
              // 器がまだできていないこともあるので、覚えておいて器ができたときに渡し直す
              lastPeersRef.current = peers
              sessionRef.current?.setPeers(peers)
              // 1つ前の版の画面が混ざっている間は、こちらが輪から降りる。
              // 相手は人ごとに数えているので、こちらが指した返事役に応えられず、
              // 待ちぼうけの末に各自が種をまいて本文が二重になる
              if (peers.some((peer) => peer.outdated && peer.id !== tabIdRef.current)) {
                peerOutdatedRef.current = true
                sessionRef.current?.degrade('peer-outdated')
                // 器がまだ無いと上の縮退が走らないので、名乗りはここでも下ろす。
                // 名乗ったまま輪に入らない人が残ると、ほかの人が猶予切れまで待たされる
                setCollabPresentRef.current(false)
                setDegradedReason((prev) => prev ?? 'peer-outdated')
                return
              }
              setScribeId(electScribe(peers))
              if (colorIndexRef.current === null) {
                colorIndexRef.current = colorIndexOf(peers, selfUserIdRef.current)
                setColorIndex(colorIndexRef.current)
                // 取った番号を在席で配る。配らないと、あとから入った人が同じ番号を取る
                setColorIndexRef.current(colorIndexRef.current)
              }
              // 人数が多い部屋では、**あとから入ったタブから**輪に入らない形に落とす
              // （全員で落とすと、先に書いていた人まで巻き込む）
              if (tabIdRef.current && rankOf(peers, tabIdRef.current) >= MAX_COLLAB_PEERS) {
                sessionRef.current?.degrade('too-many-peers')
              }
            },
            onStatus: (status: CollabStatus) => transport.setStatus(status),
          }
        : undefined,
    [wanted, transport]
  )

  // 顔ぶれは `onPeers` で直に受け取る（React の状態より早く、取りこぼしが無い）。
  // ここで受ける `others` は「〇〇さんが書いています」の表示にだけ使う
  const {
    others,
    setEditing,
    sendCollab,
    setCollabActive,
    setCollabPresent,
    setCollabState,
    setColorIndex: publishColorIndex,
  } = useMinutesPresence({
    meetingId,
    enabled: presenceEnabled,
    self,
    tabId,
    collab: collabWiring,
  })

  useEffect(() => {
    selfUserIdRef.current = self.userId
    setCollabActiveRef.current = setCollabActive
    setCollabPresentRef.current = setCollabPresent
    setCollabStateRef.current = setCollabState
    setColorIndexRef.current = publishColorIndex
    transport.setSender(sendCollab)
    return () => transport.setSender(null)
  }, [
    transport,
    sendCollab,
    setCollabActive,
    setCollabPresent,
    setCollabState,
    publishColorIndex,
    tabId,
    self.userId,
  ])

  /**
   * 「いまこの議事録を開いて同時編集に加わるつもりだ」を、**器の用意が終わる前から**
   * 在席で伝える。伝えないと、ほぼ同時に開いた相手がこちらに気づかず、自分で本文を
   * 作ってしまい、合流したときに中身が二重になる（片方を消してももう片方が残る）。
   */
  useEffect(() => {
    if (!wanted || degradedReason) return
    // スマホは輪に加われないので名乗らない。名乗ると、加わらないのに相手を
    // 待たせるだけになる（相手はこちらの返事を待って猶予切れまで書けない）
    if (!isDesktopWidth()) return
    setCollabPresent(true)
  }, [wanted, degradedReason, setCollabPresent])

  const registerSeeder = useCallback((seeder: MinutesSeeder | null) => {
    seederRef.current = seeder
    const current = sessionRef.current
    if (!current || current.isDegraded) return
    current.setSeeder(seeder)
    // 始める前に、いまの顔ぶれを渡し直す。始まった時点の顔ぶれで
    // 「本文を作るか・相手に聞くか」が決まるため
    current.setPeers(lastPeersRef.current)
    if (seeder) current.start()
  }, [])

  const isApplyingRemote = useCallback(() => sessionRef.current?.isApplyingRemote === true, [])

  const requestRoomReload = useCallback(() => {
    sessionRef.current?.requestRoomReload()
  }, [])

  // 1人で書く形: 器そのものが無いか、本文が入る前に落ちたとき
  const solo = !session || soloFallback
  return {
    others,
    setEditing,
    active: !!session && !degradedReason,
    pending: preparing && !degradedReason,
    solo,
    /**
     * 書記として振る舞うのは**本文が入ってから**。入る前に保存へ行くと、
     * 空の器の中身で議事録を上書きしてしまう。
     */
    isScribe: solo || !!degradedReason || (synced && !!tabId && scribeId === tabId),
    fragment: solo ? null : (session?.fragment ?? null),
    awareness: solo ? null : (session?.awareness ?? null),
    meta: session?.meta ?? null,
    isApplyingRemote,
    synced: solo || synced,
    colorIndex,
    degradedReason,
    registerSeeder,
    requestRoomReload,
  }
}
