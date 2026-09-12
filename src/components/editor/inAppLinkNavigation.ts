'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { isInAppScreenHref } from '@/lib/navigation/appLinks'

/** クリックのうち、行き先を決めるのに要る分だけ */
interface EditorClick {
  target: EventTarget | null
  button: number
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  defaultPrevented?: boolean
}

/**
 * このクリックで、アプリの中の画面へ同じタブで移るべきか。移るなら行き先の href を返す。
 *
 * BlockNote（TipTap）は本文中のリンクを `target="_blank"` ＋ `window.open` で開くので、
 * 何もしないと参照するたびにタブが増え、ブラウザの「戻る」で書いていたページに戻れない。
 * アプリの中の画面だけを横取りして、同じタブで移り履歴に積む。
 *
 * 横取りしないもの:
 * - ファイルのダウンロード（`/api/...`）。画面が変わらないので今までどおりでよい
 * - 外部のサイト
 * - Cmd / Ctrl / Shift / Alt を押しながら、または中クリック。新しいタブで開きたい意思表示なので邪魔しない
 */
export function resolveInAppLinkTarget(event: EditorClick): string | null {
  if (event.defaultPrevented) return null
  if (event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null

  const target = event.target
  if (!(target instanceof Element)) return null
  const anchor = target.closest('a[href]')
  const href = anchor?.getAttribute('href')
  return isInAppScreenHref(href) ? href! : null
}

/**
 * 文書エディタの外枠に付ける ref。本文中のアプリ内リンクを横取りして、同じタブで移る。
 *
 * **DOM に直接、capture（降りてくる）側で付ける**。React の onClickCapture では
 * BlockNote 自身のクリック処理より先に止めきれず、同じタブへの移動と別タブの両方が起きる
 * （実機で確認）。
 *
 * `onBeforeNavigate` には、待ち時間中の自動保存を確定させる処理を渡す。
 * 渡さないと、書いた直後にリンクを押したときに最後の一手が保存されないまま画面が変わる。
 * **保存しきれなかったとき（例外）は移動しない**。書きかけを消すより、その場に留まって
 * 画面に出ている理由を読んでもらうほうがよい。
 *
 * `enabled` が false のときは何も付けない（相手先ポータルでは社内の画面へ連れて行けないため）。
 */
export function useInAppLinkNavigation(
  onBeforeNavigate?: () => void | Promise<void>,
  enabled = true
) {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeNavigateRef = useRef(onBeforeNavigate)

  useEffect(() => {
    beforeNavigateRef.current = onBeforeNavigate
  }, [onBeforeNavigate])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !enabled) return

    const handleClick = (event: MouseEvent) => {
      const href = resolveInAppLinkTarget(event)
      if (!href) return
      event.preventDefault()
      event.stopPropagation()
      void Promise.resolve()
        .then(() => beforeNavigateRef.current?.())
        .then(() => {
          router.push(href)
        })
        .catch(() => {
          // 保存できていないので移動しない（呼び出し側が画面に理由を出している）
        })
    }

    /**
     * BlockNote（ProseMirror）は「押した→離した」からリンクを開く処理を始めるので、
     * click を止めるだけでは別タブが開いてしまう（実機で確認）。押した時点で止める
     */
    const stopBeforeEditor = (event: MouseEvent) => {
      if (!resolveInAppLinkTarget(event)) return
      event.preventDefault()
      event.stopPropagation()
    }

    container.addEventListener('mousedown', stopBeforeEditor, true)
    container.addEventListener('mouseup', stopBeforeEditor, true)
    container.addEventListener('click', handleClick, true)
    return () => {
      container.removeEventListener('mousedown', stopBeforeEditor, true)
      container.removeEventListener('mouseup', stopBeforeEditor, true)
      container.removeEventListener('click', handleClick, true)
    }
  }, [router, enabled])

  return containerRef
}
