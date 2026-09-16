'use client'

import { useSyncExternalStore } from 'react'

/**
 * いまダークテーマかどうか（<html> に .dark が付いているか）。
 *
 * 色は原則 globals.css の中央トークンで反転させるが、BlockNote のように
 * 「テーマを React の props で受け取る」部品には、真偽値で渡す必要がある。
 * .dark の付け外しは ThemeSync が行うので、ここではその結果だけを見る。
 */
function subscribe(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {}
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

function getSnapshot(): boolean {
  return document.documentElement.classList.contains('dark')
}

/** SSR とハイドレーション直後はライト扱い（描画前 inline script が .dark を付ける前でも崩れない） */
function getServerSnapshot(): boolean {
  return false
}

export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
