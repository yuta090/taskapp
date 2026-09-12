'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { RealtimeChannel } from '@supabase/supabase-js'

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
}

interface MinutesPresenceSelf {
  userId: string
  name: string
}

interface UseMinutesPresenceOptions {
  meetingId: string
  /** 書ける人が、詳細を読み込み終えて開いている間だけ true。閲覧だけの人は購読しない */
  enabled: boolean
  self: MinutesPresenceSelf
}

interface UseMinutesPresenceResult {
  /** 自分以外の在席。表示するかどうか（editing だけ出す等）は呼び出し側が決める */
  others: MinutesPresencePeer[]
  /** エディタの focusin・本文の変更・領域外への focusout を伝える入口 */
  setEditing: (editing: boolean) => void
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
}

const EMPTY_PEERS: MinutesPresencePeer[] = []

/** 中身が同じなら同じ配列を使い回す（無駄な再描画を起こさない） */
function samePeers(a: MinutesPresencePeer[], b: MinutesPresencePeer[]): boolean {
  if (a.length !== b.length) return false
  return a.every((peer, i) => {
    const other = b[i]
    return peer.userId === other.userId && peer.name === other.name && peer.editing === other.editing
  })
}

function warnPresence(message: string, err?: unknown): void {
  console.warn(`[minutes-presence] ${message}`, err)
}

export function useMinutesPresence({
  meetingId,
  enabled,
  self,
}: UseMinutesPresenceOptions): UseMinutesPresenceResult {
  // useRealtimeResponses と同じく、クライアントは1回だけ作って使い回す
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

  const channelRef = useRef<RealtimeChannel | null>(null)
  const editingRef = useRef(false)
  /** 最後にチャネルへ送った editing。まだ送っていなければ null */
  const trackedRef = useRef<boolean | null>(null)
  const sinceRef = useRef(0)
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 状態が変わったときだけ送る（打つたびには送らない） */
  const pushTrack = useCallback(() => {
    const channel = channelRef.current
    if (!channel) return
    if (trackedRef.current === editingRef.current) return
    trackedRef.current = editingRef.current
    const payload: PresencePayload = {
      user_id: userIdRef.current,
      name: nameRef.current || FALLBACK_NAME,
      editing: editingRef.current,
      since: sinceRef.current,
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

    const syncOthers = () => {
      const current = channel
      if (!current) return
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
          next.push({ userId: peerId, name: peerName || FALLBACK_NAME, editing: meta.editing === true })
        }
        setOthers((prev) => (samePeers(prev, next) ? prev : next))
      } catch (err) {
        warnPresence('在席を読み取れませんでした', err)
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
      closeChannel()
    }

    /** つながらなかったとき、少し待ってやり直す（回数は RETRY_DELAYS_MS まで） */
    const scheduleRetry = (status: string) => {
      const delay = RETRY_DELAYS_MS[attempt - 1]
      if (delay === undefined) {
        warnPresence(`在席を共有できませんでした (${status})。やり直してもつながらないので諦めます`)
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
        // anon の鍵ではポリシーに当たらず必ず失敗するので、つなぎに行かない
        warnPresence('鍵が取れなかったため、在席の共有は始めません')
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
          config: { private: true, presence: { key: userId } },
        })
        channel = created
        created
          .on('presence', { event: 'sync' }, syncOthers)
          .on('presence', { event: 'join' }, syncOthers)
          .on('presence', { event: 'leave' }, syncOthers)
          .subscribe((status) => {
            // 閉じたあと・やり直しで作り替えたあとの古い知らせは無視する
            if (disposed || channel !== created) return
            if (status === 'SUBSCRIBED') {
              clearRetryTimer()
              channelRef.current = created
              trackedRef.current = null
              pushTrack()
              syncOthers()
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

  return { others, setEditing }
}
