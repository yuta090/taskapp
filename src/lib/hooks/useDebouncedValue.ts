'use client'

import { useEffect, useState } from 'react'

/**
 * 値が落ち着くまで待ってから確定させる。
 * 検索欄の1打鍵ごとにサーバーへ問い合わせないために使う。
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return settled
}
