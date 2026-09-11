'use client'

import { useEffect, useRef } from 'react'

/**
 * 成功後の window.location.assign/replace() は「遷移を予約するだけですぐ返る」ため、
 * ログイン系フォームはページが実際に破棄されるまで意図的にローディング状態を維持する
 * （二重送信防止・LoginClient / MfaChallengeClient 等のコメント参照）。
 *
 * ただし iPhone Safari 等がページを bfcache（back-forward cache）からそのまま復元した
 * 場合、そのページは実際には破棄されておらず、ローディング状態を戻す機会が無いまま
 * ボタンが永久に押せなくなる（例: ログイン成功 → 別画面へ遷移 → スワイプで戻る）。
 * `pageshow` の `event.persisted === true` が bfcache からの復元を示すので、それを
 * 検知したときだけ渡された reset() でローディング状態を解除する。
 *
 * `reset` は ref で保持し、呼び出し側で useCallback しなくても毎回の再生成で
 * リスナーを張り直さないようにしている（マウント時に一度だけ addEventListener する）。
 */
export function useResetOnBfcacheRestore(reset: () => void): void {
  const resetRef = useRef(reset)
  // render中に ref.current を書き換えない（react-hooks/refs）。effect（render後）で同期する
  useEffect(() => {
    resetRef.current = reset
  })

  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) resetRef.current()
    }
    window.addEventListener('pageshow', handlePageShow)
    return () => window.removeEventListener('pageshow', handlePageShow)
  }, [])
}
