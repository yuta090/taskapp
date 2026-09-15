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
  /** その人が部屋に入った時刻（epoch ミリ秒）。書記を決めるのに使う */
  joinedAt: number
  /** いま同時編集の輪に入っているか。落ちた人は書記の候補から外す */
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
  onPeers: (peers: { userId: string; joinedAt: number; collab: boolean }[]) => void
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
  /** 自分が部屋に入った時刻。書記を決めるとき、相手と同じ物差しで比べるために出す */
  selfJoinedAt: number
}

/**
 * チャネルに載せる在席の中身。
 * since は「いつから書いているか」の目安で、画面には出さない（epoch ミリ秒）。
 * 日付を文字列にして持つと toISOString 由来の日付ずれを招くため、数値のまま扱う。
 */
type PresencePayload = {
  user_id: string
  name: string
  editing: boolean
  since: number
  /** 部屋に入った時刻。書記（列に保存する1人）を全員が同じ答えで選ぶために載せる */
  joined_at: number
  /** 同時編集の輪に入っているか。落ちた人を書記にすると誰の内容も保存されなくなる */
  collab: boolean
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
  collab,
}: UseMinutesPresenceOptions): UseMinutesPresenceResult {
  // クライアントは1回だけ作って使い回す
  const supabase = useMemo(() => createClient(), [])
  const [others, setOthers] = useState<MinutesPresencePeer[]>(EMPTY_PEERS)

  const { userId, name } = self

  // 購読し直さずに最新の値を読めるようにする（名前の取得が後から届いても送り直さない）
  const userIdRef = useRef(userId)
  const nameRef = useRef(name)
  useEffect(() => {
    userIdRef.current = userId
    nameRef.current = name
  }, [userId, name])

  // 同時編集の口は、購読をやり直さずに最新の関数を読めるよう ref に詰め替える
  // （毎レンダーで新しい関数が来ても、チャネルを作り直さない）
  const collabRef = useRef(collab)
  useEffect(() => {
    collabRef.current = collab
  }, [collab])

  const channelRef = useRef<RealtimeChannel | null>(null)
  /**
   * 自分が部屋に入った時刻。この画面を開いている間は変えない。
   * 時刻を読むのは描画のあと（effect）にする。描画の途中で読むと、同じ描画が
   * 2回走ったときに値が変わりうる。
   */
  const joinedAtRef = useRef(0)
  const [selfJoinedAt, setSelfJoinedAt] = useState(0)
  useEffect(() => {
    if (joinedAtRef.current !== 0) return
    joinedAtRef.current = Date.now()
    setSelfJoinedAt(joinedAtRef.current)
  }, [])
  const editingRef = useRef(false)
  /** いま自分が同時編集の輪に入っているか。落ちたら送り直して相手に伝える */
  const collabActiveRef = useRef(true)
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
      name: nameRef.current || FALLBACK_NAME,
      editing: editingRef.current,
      since: sinceRef.current,
      joined_at: joinedAtRef.current,
      collab: collabActiveRef.current,
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
    if (!enabled || !meetingId || !userId) return

    let disposed = false
    let channel: RealtimeChannel | null = null
    /** 何回目の購読か（1 が最初。RETRY_DELAYS_MS の数だけやり直す） */
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    /** 在席の一覧が1回でも届いたか。届くまで同時編集は始めない */
    let presenceArrived = false
    let presenceWaitTimer: ReturnType<typeof setTimeout> | null = null

    /** いま部屋に居る自分以外の人。読み取れなければ null（＝分からない） */
    const syncOthers = (): MinutesPresencePeer[] | null => {
      const current = channel
      if (!current) return null
      try {
        const state = current.presenceState<Partial<PresencePayload>>()
        const next: MinutesPresencePeer[] = []
        for (const [key, metas] of Object.entries(state)) {
          const meta = metas[metas.length - 1]
          if (!meta) continue
          const peerId = typeof meta.user_id === 'string' && meta.user_id ? meta.user_id : key
          // 自分は出さない（別のタブで開いていても自分は自分）
          if (peerId === userId) continue
          if (next.some((peer) => peer.userId === peerId)) continue
          const peerName = typeof meta.name === 'string' ? meta.name.trim() : ''
          next.push({
            userId: peerId,
            name: peerName || FALLBACK_NAME,
            editing: meta.editing === true,
            // 入った時刻が読めない相手は「ついさっき入った」扱いにする。書記を
            // 取り合わないよう、いちばん新しい側へ倒す
            joinedAt: typeof meta.joined_at === 'number' ? meta.joined_at : Number.MAX_SAFE_INTEGER,
            // 印が無い相手は、古い版の画面を開いている人。輪には入っているとみなす
            collab: meta.collab !== false,
          })
        }
        setOthers((prev) => (samePeers(prev, next) ? prev : next))
        return next
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
      const peers = syncOthers()
      if (peers === null) return
      const wiring = collabRef.current
      if (!wiring) return
      wiring.onPeers([
        { userId: userIdRef.current, joinedAt: joinedAtRef.current, collab: collabActiveRef.current },
        ...peers.map((peer) => ({ userId: peer.userId, joinedAt: peer.joinedAt, collab: peer.collab })),
      ])
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
      if (document.visibilityState === 'hidden') setEditing(false)
    }

    const handlePageHide = () => {
      disposed = true
      teardown()
    }

    const start = async () => {
      attempt += 1
      // 書記を決めるのに使うので、つなぎに行く前に必ず入っている状態にする
      if (joinedAtRef.current === 0) joinedAtRef.current = Date.now()

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
            presence: { key: userId },
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
              setSelfJoinedAt(joinedAtRef.current)
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
  }, [enabled, meetingId, userId, supabase, pushTrack, setEditing, clearIdleTimer])

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
            from: userIdRef.current,
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

  return { others, setEditing, sendCollab, setCollabActive, selfJoinedAt }
}
