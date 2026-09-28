'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { onDocSignal } from '@/lib/hooks/useDocVoteSignal'

/** 読み直しの最短の間隔。社内は入力が止まるたびに保存するので、知らせのたびに本文（最大数百KB）を取ると重い */
const MIN_INTERVAL_MS = 5_000
/** 知らせが届かない（つながらない）ときの保険。進行中の間はこの間隔でも読み直す */
const FALLBACK_INTERVAL_MS = 60_000

/**
 * 相手先ポータルで、会議中（進行中）に社内が保存した議事録を読み直して返す（DOC_VOTE_SPEC §6.1）。
 * 「保存された」知らせ（本文は運ばない）を受けて、RLS 越しに本文の列だけを取り直す。
 *
 * - 5秒に1回まで。最後の知らせは必ず反映する（間隔が明けたら取る）
 * - 取りに行っている間は重ねない（終わったらもう1回）。重ねると古い結果があとから届いて上書きしうる
 * - 画面が裏に回っている間は取らず、表に戻ったら1回
 * - チャネルにつながった直後にも1回（つながる前・切れていた間の保存を拾う）
 * - 取った本文がいまと同じなら描き直さない
 */
export function useLiveMinutes(meetingId: string, live: boolean, initialMd: string | null | undefined) {
  const [fetched, setFetched] = useState<{ id: string; md: string } | null>(null)
  const currentRef = useRef<string | null | undefined>(initialMd)
  const md = fetched?.id === meetingId ? fetched.md : initialMd
  useEffect(() => {
    currentRef.current = md
  }, [md])

  useEffect(() => {
    if (!live) return
    let disposed = false
    let inFlight = false
    let wanted = false
    let lastAt = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    const supabase = createClient()

    const run = async () => {
      timer = null
      if (disposed) return
      if (document.visibilityState !== 'visible') return // 表に戻ったら visibilitychange で取る
      if (inFlight) return // 終わったところで wanted を見てもう1回
      wanted = false
      inFlight = true
      lastAt = Date.now()
      try {
        const { data, error } = await supabase.from('meetings').select('minutes_md').eq('id', meetingId).maybeSingle()
        if (!disposed && !error && data) {
          const next = (data as { minutes_md: string | null }).minutes_md ?? ''
          if (next !== currentRef.current) setFetched({ id: meetingId, md: next })
        }
      } finally {
        inFlight = false
        if (wanted && !disposed) schedule()
      }
    }

    const schedule = () => {
      wanted = true
      if (timer || inFlight) return
      const wait = Math.max(0, lastAt + MIN_INTERVAL_MS - Date.now())
      timer = setTimeout(() => void run(), wait)
    }

    const topic = `meeting-minutes-view:${meetingId}`
    const offSaved = onDocSignal(topic, 'minutes-saved', schedule)
    const offSubscribed = onDocSignal(topic, 'subscribed', schedule)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && wanted) schedule()
    }
    document.addEventListener('visibilitychange', onVisible)
    const fallback = setInterval(schedule, FALLBACK_INTERVAL_MS)

    return () => {
      disposed = true
      offSaved()
      offSubscribed()
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(fallback)
      if (timer) clearTimeout(timer)
    }
  }, [live, meetingId])

  return md
}
