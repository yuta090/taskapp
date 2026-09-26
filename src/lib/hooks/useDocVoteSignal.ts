'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { DocPollSource } from '@/lib/doc-polls/types'

/**
 * 投票の「票が変わった」合図を、同じ文書を開いている人どうしで送り合う（DOC_VOTE_SPEC §6）。
 *
 * 本番の Realtime は表の変化を配らないので、押した画面が合図だけを送り、受けた画面が
 * 表の RLS 越しに票を読み直す。合図は本文も票も運ばない（偽の合図で起きるのは読み直しだけ）。
 *
 * - チャネルは private（DB のポリシー doc_vote_signal_* が効くのは private だけ）
 * - ポリシーは本人にしか効かないので、購読の前に本人の鍵を `setAuth(token)` へ引数で渡す
 *   （引数なしだと auth の初期化前は anon キーのままで断られる）
 * - つながらなくても画面は壊さない。2回までやり直して諦める（読み直しは開き直し・定期の読み直しに任せる）
 */

const SIGNAL_EVENT = 'vote-changed'

/**
 * 同じチャネルに相乗りするほかの知らせ。同じ名前のチャネルを2本開くと互いに閉じ合うので、
 * 道は1本のまま知らせの種類で振り分ける。
 * - minutes-saved: 議事録が保存された（書記が保存のあとに送る。相手先ポータルが本文を読み直す・PR4）
 * - insertion-changed: 相手先の差し込みの台帳が変わった（作った・取り下げた・反映した。PR5）
 * - subscribed   : （送らない・この画面の中だけ）チャネルにつながった。つながる前の分を読み直す合図
 */
export type DocSignalEvent = 'minutes-saved' | 'insertion-changed' | 'subscribed'
const EXTRA_EVENTS: readonly DocSignalEvent[] = ['minutes-saved', 'insertion-changed']

function dispatchLocal(topic: string, event: DocSignalEvent) {
  listeners.get(listenerKey(topic, event))?.forEach((cb) => cb())
}

// いまつながっているチャネル（名前ごと）と、知らせを待っている人。フックの外（保存の処理など）から
// 送る・受けるために、画面全体で1つだけ持つ
const liveChannels = new Map<string, RealtimeChannel>()
const listeners = new Map<string, Set<() => void>>()
const listenerKey = (topic: string, event: DocSignalEvent) => `${topic}|${event}`

/** その文書の知らせを待つ。戻り値を呼ぶとやめる。チャネルは useDocVoteSignal が開いているものを使う */
export function onDocSignal(topic: string, event: DocSignalEvent, cb: () => void): () => void {
  const key = listenerKey(topic, event)
  const set = listeners.get(key) ?? new Set()
  set.add(cb)
  listeners.set(key, set)
  return () => {
    set.delete(cb)
    if (set.size === 0) listeners.delete(key)
  }
}

/** その文書のチャネルで知らせを送る。つながっていなければ何もしない（画面は壊さない） */
export function sendDocSignal(topic: string, event: DocSignalEvent): void {
  // 同じ画面の中で待っている人にも届ける（自分の合図はチャネルから戻ってこない。self: false）。
  // 例: 社内の画面が保存したあと、同じ画面の差し込みの取り込みが「反映済み」の確認を回す
  dispatchLocal(topic, event)
  const ch = liveChannels.get(topic)
  if (!ch) return
  void Promise.resolve(ch.send({ type: 'broadcast', event, payload: {} })).catch((err) => {
    warnSignal('知らせを送れませんでした', err)
  })
}

/** つながらなかったときにやり直すまでの待ち時間。要素の数だけやり直す */
const RETRY_DELAYS_MS = [2_000, 6_000]

export function docVoteSignalTopic(source: DocPollSource | null): string | null {
  if (source?.wikiPageId) return `wiki-page-view:${source.wikiPageId}`
  if (source?.meetingId) return `meeting-minutes-view:${source.meetingId}`
  return null
}

function warnSignal(message: string, err?: unknown): void {
  console.warn(`[doc-vote-signal] ${message}`, err)
}

export function useDocVoteSignal(source: DocPollSource | null, onSignal: () => void) {
  const supabase = useMemo(() => createClient(), [])
  const topic = docVoteSignalTopic(source)
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  // 呼ぶ側が毎回新しい関数を渡しても、つなぎ直さない
  const onSignalRef = useRef(onSignal)
  useEffect(() => {
    onSignalRef.current = onSignal
  }, [onSignal])

  useEffect(() => {
    if (!topic) return

    let disposed = false
    let channel: RealtimeChannel | null = null
    let attempt = 0
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const closeChannel = () => {
      const current = channel
      channel = null
      channelRef.current = null
      if (topic && current && liveChannels.get(topic) === current) liveChannels.delete(topic)
      setConnected(false)
      if (!current) return
      try {
        supabase.removeChannel(current)
      } catch (err) {
        warnSignal('チャネルを閉じられませんでした', err)
      }
    }

    const scheduleRetry = (status: string) => {
      if (retryTimer) return
      const delay = RETRY_DELAYS_MS[attempt - 1]
      if (delay === undefined) {
        warnSignal(`合図のチャネルにつながりませんでした (${status})。諦めます`)
        return
      }
      warnSignal(`合図のチャネルにつながりませんでした (${status})。${delay / 1000}秒後にやり直します`)
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (disposed) return
        // 鍵の取得からやり直す（鍵が新しくなっていることがある）
        closeChannel()
        void start()
      }, delay)
    }

    const start = async () => {
      attempt += 1
      let token: string | null = null
      try {
        const { data } = await supabase.auth.getSession()
        token = data.session?.access_token ?? null
      } catch (err) {
        warnSignal('鍵を取れませんでした', err)
      }
      if (disposed) return
      // anon の鍵ではポリシーに当たらず必ず断られるので、つなぎに行かない
      if (!token) return
      try {
        await supabase.realtime.setAuth(token)
      } catch (err) {
        warnSignal('鍵を渡せませんでした', err)
      }
      if (disposed) return

      // 同じ名前のチャネルが一覧に残っていると、channel() はそれ（閉じている途中のもの）を返し、
      // subscribe() が何もしないまま固まる。すぐ開き直したときに起きるので、先に外して待つ
      const stale = supabase.getChannels().find((c) => c.topic === `realtime:${topic}`)
      if (stale) {
        try {
          await supabase.removeChannel(stale)
        } catch (err) {
          warnSignal('残っていたチャネルを外せませんでした', err)
        }
        if (disposed) return
      }

      try {
        const created = supabase.channel(topic, {
          // 自分の合図は受け取らない（押した側は自分で読み直している）。受領確認は待たない
          config: { private: true, broadcast: { self: false, ack: false } },
        })
        channel = created
        // 購読の前に登録する（あとから足すと最初の合図を取りこぼす）
        created.on('broadcast', { event: SIGNAL_EVENT }, () => {
          onSignalRef.current()
        })
        for (const event of EXTRA_EVENTS) {
          created.on('broadcast', { event }, () => {
            listeners.get(listenerKey(topic, event))?.forEach((cb) => cb())
          })
        }
        created.subscribe((status) => {
          if (disposed || channel !== created) return
          if (status === 'SUBSCRIBED') {
            // やり直しの回数は、つながるたびに数え直す（長い会議で何度切れてもやり直す）。
            // いまつながった回を1回目として数える
            attempt = 1
            channelRef.current = created
            liveChannels.set(topic, created)
            setConnected(true)
            dispatchLocal(topic, 'subscribed')
            // つなぐ前と、切れていた間に押された票は合図が届いていないので、1回読み直す
            onSignalRef.current()
            return
          }
          // CLOSED はサーバーに閉じられたとき（鍵の期限切れなど）。自分で閉じたときは上で弾いている
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            channelRef.current = null
            if (liveChannels.get(topic) === created) liveChannels.delete(topic)
            setConnected(false)
            scheduleRetry(status)
          }
        })
      } catch (err) {
        warnSignal('合図のチャネルを始められませんでした', err)
      }
    }

    void start()

    return () => {
      disposed = true
      if (retryTimer) clearTimeout(retryTimer)
      closeChannel()
    }
  }, [topic, supabase])

  /** 票が変わったことをほかの人に知らせる。つながっていなければ何もしない */
  const notify = useCallback(() => {
    const current = channelRef.current
    if (!current) return
    void Promise.resolve(current.send({ type: 'broadcast', event: SIGNAL_EVENT, payload: {} })).catch((err) => {
      warnSignal('合図を送れませんでした', err)
    })
  }, [])

  return { connected, notify }
}
