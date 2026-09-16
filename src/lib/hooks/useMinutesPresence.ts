'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'
import {
  bytesToBase64,
  type CollabEvent,
  type CollabMessage,
  type CollabStatus,
} from '@/lib/collab/transport'
import type { CollabPeer } from '@/lib/collab/scribe'

/**
 * 議事録の「いま誰が書いているか」を、同じ会議を開いている人どうしで見せ合う。
 *
 * Supabase Realtime の presence（在席）を使う。DB 側の認可（realtime.messages の
 * ポリシー）は **private チャネルにしか効かない** ため、`private: true` は必須。
 * 付け忘れるとポリシーが評価されず、誰でも覗ける公開チャネルになってしまう。
 *
 * ポリシーは authenticated（ログインした本人）にしか効かない。そのため購読の前に
 * 本人のアクセストークンを取り、`setAuth(token)` へ **引数として渡す**。引数なしの
 * `setAuth()` は、auth の初期化（INITIAL_SESSION）が済む前だと生成時の anon キーを
 * 使ってしまい、ポリシーに当たらず CHANNEL_ERROR になる（本番で帯が出ない原因だった）。
 *
 * 失敗しても画面は壊さない・編集は止めない（console.warn だけで黙って諦める）。
 * 同時に書けてしまったときの最後の砦は、これまで通り保存の楽観ロック。
 */

/** 何もしないまま「書いています」を下ろすまでの時間 */
const IDLE_MS = 60_000

/**
 * つながらなかったときにやり直すまでの待ち時間。
 * 要素の数だけやり直す（= 最大2回。3回目の失敗で諦める）。
 */
const RETRY_DELAYS_MS = [2_000, 6_000]

const TOPIC_PREFIX = 'meeting-minutes:'

/** 名前が取れなかった人の呼び方 */
const FALLBACK_NAME = 'メンバー'

export interface MinutesPresencePeer {
  userId: string
  name: string
  /** いま書いている最中か */
  editing: boolean
  /**
   * その人がいちばん早く入った時刻（epoch ミリ秒）。
   * 書記を決めるのに使うのは**タブごとの一覧のほう**（`CollabPeer`）で、これは表示用。
   */
  joinedAt: number
  /** その人のどれかのタブが同時編集の輪に入っているか。表示用 */
  collab: boolean
}

interface MinutesPresenceSelf {
  userId: string
  name: string
}

/**
 * 同時編集の運び役をこのチャネルに相乗りさせるための口。
 * 渡さなければ、これまでどおり在席（「書いています」）だけのチャネルになる。
 *
 * **1つのチャネルに相乗りさせる**のが要点。同じ名前のチャネルに2回入ることは
 * できないので、在席と更新の配達を別々のチャネルにはできない。
 */
export interface MinutesCollabWiring {
  onMessage: (message: CollabMessage) => void
  /**
   * 部屋の顔ぶれが変わったとき（自分を含む）。**`joined` より先に必ず1回届く**。
   * 在席の一覧は参加の返事より後に別便で来るので、参加した瞬間はまだ誰も見えない。
   * そこで書記を決めると、入ったばかりの人が「自分しか居ない」と思い込んで書記になり、
   * 自分の持っている本文で種をまいてしまう（＝本文が二重になる）。
   */
  onPeers: (peers: CollabPeer[]) => void
  /**
   * `joined` は**在席の一覧が届いてから**呼ぶ（参加の返事の時点では呼ばない）。
   * 一定時間届かなければ `error` を呼ぶ。
   */
  onStatus: (status: CollabStatus) => void
}

interface UseMinutesPresenceOptions {
  meetingId: string
  /** 書ける人が、詳細を読み込み終えて開いている間だけ true。閲覧だけの人は購読しない */
  enabled: boolean
  self: MinutesPresenceSelf
  /**
   * このタブの見分け札。**在席の鍵にもこれを使う**（人ごとにすると、同じ人の
   * 2つ目のタブが1つ目に上書きされて消える）。空のあいだは購読を始めない。
   */
  tabId: string
  /** 同時編集を使うときだけ渡す。渡すと broadcast も受け取る */
  collab?: MinutesCollabWiring
}

interface UseMinutesPresenceResult {
  /** 自分以外の在席。表示するかどうか（editing だけ出す等）は呼び出し側が決める */
  others: MinutesPresencePeer[]
  /** エディタの focusin・本文の変更・領域外への focusout を伝える入口 */
  setEditing: (editing: boolean) => void
  /** 同時編集の更新を配る。つながっていなければ何もしない */
  sendCollab: (event: CollabEvent, bytes: Uint8Array, to?: string) => void
  /**
   * 自分が輪に入っているかを在席で伝える。1人で書く形へ落ちたら false を渡す。
   * 伝えないと、落ちた自分が書記に選ばれ続け、**誰の書いた内容も列に残らなくなる**。
   */
  setCollabActive: (active: boolean) => void
}

/**
 * チャネルに載せる在席の中身。
 * since は「いつから書いているか」の目安で、画面には出さない（epoch ミリ秒）。
 * 日付を文字列にして持つと toISOString 由来の日付ずれを招くため、数値のまま扱う。
 */
type PresencePayload = {
  user_id: string
  /** このタブの見分け札。同じ人の別タブを別々の参加者として扱うために載せる */
  client_id: string
  name: string
  editing: boolean
  since: number
  /** 部屋に入った時刻。書記（列に保存する1人）を全員が同じ答えで選ぶために載せる */
  joined_at: number
  /** 同時編集の輪に入っているか。落ちた人を書記にすると誰の内容も保存されなくなる */
  collab: boolean
  /** このタブが手前に出ているか。裏のタブを書記にすると保存が何分も遅れる */
  visible: boolean
}

/** 同時編集でやり取りする4種類（broadcast のイベント名） */
const COLLAB_EVENTS: CollabEvent[] = ['y-sync1', 'y-sync2', 'y-update', 'y-aware', 'y-reload']

/**
 * 在席の一覧が届くのを待つ上限。
 * `SUBSCRIBED` は参加の返事で発火し、在席の一覧（`presence_state`）は**その後に
 * 別便で届く**。届くまで書記を決められないので待つが、来ないまま黙り込まれると
 * エディタが空の読み取り専用で固まるため、ここで見切る。
 */
const PRESENCE_WAIT_MS = 5_000

const EMPTY_PEERS: MinutesPresencePeer[] = []

/** 中身が同じなら同じ配列を使い回す（無駄な再描画を起こさない） */
function samePeers(a: MinutesPresencePeer[], b: MinutesPresencePeer[]): boolean {
  if (a.length !== b.length) return false
  return a.every((peer, i) => {
    const other = b[i]
    return (
      peer.userId === other.userId &&
      peer.name === other.name &&
      peer.editing === other.editing &&
      peer.joinedAt === other.joinedAt &&
      peer.collab === other.collab
    )
  })
}

function warnPresence(message: string, err?: unknown): void {
  console.warn(`[minutes-presence] ${message}`, err)
}

export function useMinutesPresence({
  meetingId,
  enabled,
  self,
  tabId,
  collab,
}: UseMinutesPresenceOptions): UseMinutesPresenceResult {
  // クライアントは1回だけ作って使い回す
  const supabase = useMemo(() => createClient(), [])
  const [others, setOthers] = useState<MinutesPresencePeer[]>(EMPTY_PEERS)

  const { userId, name } = self

  // 購読し直さずに最新の値を読めるようにする（名前の取得が後から届いても送り直さない）
  const userIdRef = useRef(userId)
  const nameRef = useRef(name)
  const tabIdRef = useRef(tabId)
  useEffect(() => {
    userIdRef.current = userId
    nameRef.current = name
    tabIdRef.current = tabId
  }, [userId, name, tabId])

  // 同時編集の口は、購読をやり直さずに最新の関数を読めるよう ref に詰め替える
  // （毎レンダーで新しい関数が来ても、チャネルを作り直さない）
  const collabRef = useRef(collab)
  useEffect(() => {
    collabRef.current = collab
  }, [collab])

  const channelRef = useRef<RealtimeChannel | null>(null)
  /**
   * 自分が部屋に入った時刻（座席）。チャネルに入るたびに取り直す。
   * 顔ぶれは `onPeers` で直に渡すので、描画のための状態にはしない
   * （状態にすると、入り直すたびに画面を描き直すことになる）。
   */
  const joinedAtRef = useRef(0)
  const editingRef = useRef(false)
  /**
   * いま自分が同時編集の輪に入っているか＝**本文の入った器を持っているか**。
   *
   * 既定は false。スマホ・器の読み込みに失敗したとき・同時編集を使わない組織では、
   * ずっと false のままになる。true を名乗ってしまうと、器を持っていない自分が
   * 書記（列へ保存する1人）に選ばれ、**部屋の誰の書いた内容も列に残らなくなる**。
   */
  const collabActiveRef = useRef(false)
  /** このタブが手前に出ているか。裏に回ると書記の候補から後ろへ下がる */
  const visibleRef = useRef(true)
  /** 最後にチャネルへ送った editing。まだ送っていなければ null */
  const trackedRef = useRef<boolean | null>(null)
  const sinceRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 状態が変わったときだけ送る（打つたびには送らない） */
  const pushTrack = useCallback((force = false) => {
    const channel = channelRef.current
    if (!channel) return
    if (!force && trackedRef.current === editingRef.current) return
    trackedRef.current = editingRef.current
    const payload: PresencePayload = {
      user_id: userIdRef.current,
      client_id: tabIdRef.current,
      name: nameRef.current || FALLBACK_NAME,
      editing: editingRef.current,
      since: sinceRef.current,
      joined_at: joinedAtRef.current,
      collab: collabActiveRef.current,
      visible: visibleRef.current,
    }
    try {
      void Promise.resolve(channel.track(payload)).catch((err) => {
        warnPresence('在席を送れませんでした', err)
      })
    } catch (err) {
      warnPresence('在席を送れませんでした', err)
    }
  }, [])

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current)
      idleTimerRef.current = null
    }
  }, [])

  const setEditing = useCallback(
    (next: boolean) => {
      if (next) {
        if (!editingRef.current) {
          editingRef.current = true
          sinceRef.current = Date.now()
        }
        // 打つたびに呼ばれる。数え直すだけで、送るのは状態が変わったときだけ
        clearIdleTimer()
        idleTimerRef.current = setTimeout(() => {
          idleTimerRef.current = null
          editingRef.current = false
          pushTrack()
        }, IDLE_MS)
        pushTrack()
        return
      }
      clearIdleTimer()
      if (!editingRef.current) return
      editingRef.current = false
      pushTrack()
    },
    [clearIdleTimer, pushTrack]
  )

  useEffect(() => {
    if (!enabled || !meetingId || !userId || !tabId) return

    let disposed = false
    let channel: RealtimeChannel | null = null
    /** 何回目の購読か（1 が最初。RETRY_DELAYS_MS の数だけやり直す） */
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    /** 在席の一覧が1回でも届いたか。届くまで同時編集は始めない */
    let presenceArrived = false
    let presenceWaitTimer: ReturnType<typeof setTimeout> | null = null

    /**
     * 在席を読み直す。**2つの一覧を作る**のが要点。
     *  - 帯用（`others`）: 人ごと。自分は出さず、同じ人の別タブは1人にまとめる
     *  - 同時編集用（`room`）: タブごと。自分のタブも入れる（書記を決めるため）
     * 読み取れなければ null（＝分からない）。
     */
    const syncOthers = (): { others: MinutesPresencePeer[]; room: CollabPeer[] } | null => {
      const current = channel
      if (!current) return null
      try {
        const state = current.presenceState<Partial<PresencePayload>>()
        const next: MinutesPresencePeer[] = []
        const room: CollabPeer[] = []
        for (const [key, metas] of Object.entries(state)) {
          const meta = metas[metas.length - 1]
          if (!meta) continue
          const tab = typeof meta.client_id === 'string' && meta.client_id ? meta.client_id : key
          const peerId = typeof meta.user_id === 'string' && meta.user_id ? meta.user_id : key
          // 入った時刻が読めない相手は「ついさっき入った」扱いにする。書記を
          // 取り合わないよう、いちばん新しい側へ倒す
          const joinedAt = typeof meta.joined_at === 'number' ? meta.joined_at : Number.MAX_SAFE_INTEGER
          // 印が無い相手は、同時編集を持たない版の画面を開いている人。輪には
          // 入れない（その人はこれまでどおり自分で保存する）
          // 見分け札を持たない相手は、同時編集がタブ単位になる前の版の画面。
          // **輪から外すのではなく印を付けて渡す**。外すと「自分ひとりだ」と見えて
          // 目録合わせをせずに種をまいてしまい、相手の器と食い違って本文が二重になる。
          // 混ざっている間は、こちら（新しい版）が輪から降りる（useMinutesCollab）
          const hasTabId = typeof meta.client_id === 'string' && !!meta.client_id
          room.push({
            id: tab,
            userId: peerId,
            joinedAt,
            collab: meta.collab === true,
            // 印が読めない相手は手前に出ている扱い（今までと同じ順番になる）
            visible: meta.visible !== false,
            outdated: !hasTabId,
          })

          // ここから帯用。自分は出さない（別のタブで開いていても自分は自分）
          if (peerId === userId) continue
          const editing = meta.editing === true
          const already = next.find((peer) => peer.userId === peerId)
          const peerName = typeof meta.name === 'string' ? meta.name.trim() : ''
          if (already) {
            // 同じ人の別タブ。どれか1つでも書いていれば「書いています」にする
            if (editing) already.editing = true
            if (joinedAt < already.joinedAt) already.joinedAt = joinedAt
            if (meta.collab === true) already.collab = true
            // 名前が読めないタブを先に拾っていたら、読めるほうで上書きする
            if (already.name === FALLBACK_NAME && peerName) already.name = peerName
            continue
          }
          next.push({
            userId: peerId,
            name: peerName || FALLBACK_NAME,
            editing,
            joinedAt,
            collab: meta.collab === true,
          })
        }
        setOthers((prev) => (samePeers(prev, next) ? prev : next))
        return { others: next, room }
      } catch (err) {
        warnPresence('在席を読み取れませんでした', err)
        return null
      }
    }

    /**
     * 在席の一覧が届いたときに呼ぶ。**ここで初めて同時編集を始める。**
     * 参加の返事（SUBSCRIBED）の時点では一覧がまだ届いておらず、必ず「自分ひとり」に
     * 見えるので、そこで始めると入った人が毎回自分の本文で器を作り直してしまう。
     */
    const handlePresence = () => {
      const read = syncOthers()
      if (read === null) return
      const wiring = collabRef.current
      if (!wiring) return
      // 自分のタブは、在席が配られる前でも顔ぶれに入れる（自分の印は自分がいちばん新しい）
      const self: CollabPeer = {
        id: tabIdRef.current,
        userId: userIdRef.current,
        joinedAt: joinedAtRef.current,
        collab: collabActiveRef.current,
        visible: visibleRef.current,
        outdated: false,
      }
      const room = read.room.some((peer) => peer.id === self.id)
        ? read.room.map((peer) => (peer.id === self.id ? { ...peer, ...self } : peer))
        : [self, ...read.room]
      wiring.onPeers(room)
      if (presenceArrived) return
      presenceArrived = true
      clearPresenceWaitTimer()
      wiring.onStatus('joined')
    }

    const clearPresenceWaitTimer = () => {
      if (presenceWaitTimer) {
        clearTimeout(presenceWaitTimer)
        presenceWaitTimer = null
      }
    }

    const clearRetryTimer = () => {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    /** いま使っているチャネルを閉じる（やり直しの前にも呼ぶ） */
    const closeChannel = () => {
      const current = channel
      channel = null
      channelRef.current = null
      // 送っていないうちは消すものが無い（つながらなかったチャネルに投げない）
      const hadTracked = trackedRef.current !== null
      trackedRef.current = null
      editingRef.current = false
      if (!current) return
      if (hadTracked) {
        try {
          void Promise.resolve(current.untrack()).catch((err) => {
            warnPresence('在席を消せませんでした', err)
          })
        } catch (err) {
          warnPresence('在席を消せませんでした', err)
        }
      }
      try {
        supabase.removeChannel(current)
      } catch (err) {
        warnPresence('チャネルを閉じられませんでした', err)
      }
    }

    const teardown = () => {
      clearIdleTimer()
      clearRetryTimer()
      clearPresenceWaitTimer()
      closeChannel()
    }

    /** つながらなかったとき、少し待ってやり直す（回数は RETRY_DELAYS_MS まで） */
    const scheduleRetry = (status: string) => {
      const delay = RETRY_DELAYS_MS[attempt - 1]
      if (delay === undefined) {
        warnPresence(`在席を共有できませんでした (${status})。やり直してもつながらないので諦めます`)
        // 同時編集はここで1人で書く形へ落とす（つながらないまま打ち続けさせない）
        collabRef.current?.onStatus('error')
        return
      }
      warnPresence(`在席を共有できませんでした (${status})。${delay / 1000}秒後にやり直します`)
      clearRetryTimer()
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (disposed) return
        // 古いチャネルを片付け、鍵の取得からやり直す（鍵が新しくなっていることがある）
        closeChannel()
        void start()
      }, delay)
    }

    const handleVisibilityChange = () => {
      const hidden = document.visibilityState === 'hidden'
      const visibleChanged = visibleRef.current !== !hidden
      // 手前かどうかを在席で伝える。裏のタブが書記だと、ブラウザが時間の進みを
      // 間引くので、手前で打っているのに保存だけが何分も遅れる。
      // 先に印を入れ替えてから「書くのをやめた」を送れば、1通にまとまる
      visibleRef.current = !hidden
      const sentByEditing = hidden && editingRef.current
      if (hidden) setEditing(false)
      if (visibleChanged && !sentByEditing) pushTrack(true)
    }

    const handlePageHide = () => {
      disposed = true
      teardown()
    }

    const start = async () => {
      attempt += 1
      // 書記を決めるのに使うので、つなぎに行く前に必ず入っている状態にする
      if (joinedAtRef.current === 0) joinedAtRef.current = Date.now()
      // 新しいタブで開いてそのまま別の作業をすると、このタブでは
      // `visibilitychange` が鳴らない。最初に一度、いまの状態を読む
      visibleRef.current = document.visibilityState !== 'hidden'

      // private チャネルのポリシーは本人（authenticated）にしか効かない。
      // 生成時の anon キーのままつなぎに行かないよう、鍵を取って明示的に渡す
      let token: string | null = null
      try {
        const { data } = await supabase.auth.getSession()
        token = data.session?.access_token ?? null
      } catch (err) {
        warnPresence('鍵を取れませんでした', err)
      }
      if (disposed) return
      if (!token) {
        // anon の鍵ではポリシーに当たらず必ず失敗するので、つなぎに行かない。
        // 黙って帰ると、同時編集が空の読み取り専用のまま固まるので必ず知らせる
        warnPresence('鍵が取れなかったため、在席の共有は始めません')
        collabRef.current?.onStatus('error')
        return
      }
      try {
        await supabase.realtime.setAuth(token)
      } catch (err) {
        warnPresence('鍵を渡せませんでした', err)
      }
      if (disposed) return

      try {
        const created = supabase.channel(`${TOPIC_PREFIX}${meetingId}`, {
          config: {
            private: true,
            // 鍵はタブごと。人ごとにすると、同じ人の2つ目のタブが1つ目を
            // 上書きして、部屋から消えてしまう
            presence: { key: tabId },
            // 自分が送ったものは受け取らない（器へ二重に取り込まないため）。
            // 受領確認は待たない（1秒に何通も流れるので待つと詰まる）
            broadcast: { self: false, ack: false },
          },
        })
        channel = created
        created
          .on('presence', { event: 'sync' }, handlePresence)
          .on('presence', { event: 'join' }, handlePresence)
          .on('presence', { event: 'leave' }, handlePresence)
        // 同時編集の更新。購読の前に登録する（あとから足すと最初の数通を取りこぼす）
        for (const event of COLLAB_EVENTS) {
          created.on('broadcast', { event }, (raw: { payload?: unknown }) => {
            const payload = raw?.payload as { from?: unknown; to?: unknown; data?: unknown } | undefined
            if (typeof payload?.from !== 'string' || typeof payload?.data !== 'string') return
            collabRef.current?.onMessage({
              event,
              from: payload.from,
              ...(typeof payload.to === 'string' ? { to: payload.to } : {}),
              payload: payload.data,
            })
          })
        }
        created.subscribe((status) => {
            // 閉じたあと・やり直しで作り替えたあとの古い知らせは無視する
            if (disposed || channel !== created) return
            if (status === 'SUBSCRIBED') {
              clearRetryTimer()
              channelRef.current = created
              trackedRef.current = null
              // 座席は「チャネルに入るたび」に取り直す。切れて入り直した人は
              // いちばん新しい人になり、書記の座は残っていた人に渡る
              joinedAtRef.current = Date.now()
              pushTrack(true)
              // **ここでは同時編集を始めない。** 在席の一覧はこの返事のあとに別便で届く
              presenceArrived = false
              clearPresenceWaitTimer()
              presenceWaitTimer = setTimeout(() => {
                presenceWaitTimer = null
                if (disposed || presenceArrived) return
                warnPresence('在席の一覧が届きませんでした。同時編集は始めません')
                collabRef.current?.onStatus('error')
              }, PRESENCE_WAIT_MS)
              return
            }
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              // つながらなくても編集は止めない。帯を出さないだけ
              channelRef.current = null
              trackedRef.current = null
              setOthers((prev) => (prev.length === 0 ? prev : EMPTY_PEERS))
              scheduleRetry(status)
            }
          })
      } catch (err) {
        warnPresence('在席の共有を始められませんでした', err)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    void start()

    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      teardown()
      setOthers((prev) => (prev.length === 0 ? prev : EMPTY_PEERS))
    }
  }, [enabled, meetingId, userId, tabId, supabase, pushTrack, setEditing, clearIdleTimer])

  /**
   * 同時編集の更新を配る。つながっていなければ黙って捨てる（打つ手は止めない。
   * 届かなかったぶんは、入り直したときの目録合わせ（`y-sync1`）で埋まる）。
   */
  const sendCollab = useCallback((event: CollabEvent, bytes: Uint8Array, to?: string) => {
    const channel = channelRef.current
    if (!channel) return
    try {
      void Promise.resolve(
        channel.send({
          type: 'broadcast',
          event,
          payload: {
            // **在席の鍵と同じ値**を載せる。人のIDを載せると、受け取る側が
            // 自分の見分け札と突き合わせられず、宛先付きの返事が全部捨てられる
            from: tabIdRef.current,
            ...(to ? { to } : {}),
            data: bytes.length === 0 ? '' : bytesToBase64(bytes),
          },
        })
      ).catch((err) => warnPresence('同時編集の更新を送れませんでした', err))
    } catch (err) {
      warnPresence('同時編集の更新を送れませんでした', err)
    }
  }, [])

  const setCollabActive = useCallback(
    (active: boolean) => {
      if (collabActiveRef.current === active) return
      collabActiveRef.current = active
      // editing が変わっていなくても送り直す（輪から抜けたことを伝えるため）
      pushTrack(true)
    },
    [pushTrack]
  )

  return { others, setEditing, sendCollab, setCollabActive }
}
