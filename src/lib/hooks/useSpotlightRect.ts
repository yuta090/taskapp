'use client'

import { useEffect, useRef, useState } from 'react'

export interface SpotlightMatch {
  rect: DOMRect | null
  /** The selector that actually matched (fallbacks considered). Null when nothing matched. */
  matchedSelector: string | null
}

const NO_MATCH: SpotlightMatch = { rect: null, matchedSelector: null }

// 配列リテラルが毎レンダー新しい参照でも effect が再購読しないよう内容で
// 安定化する。空白は子孫セレクタで使われるため、セレクタに現れ得ない
// 改行を区切りに使う。
const SEP = '\n'

/** 対象が画面外にはみ出していないか（4辺ともビューポート内か）を判定する。 */
function isFullyVisible(rect: DOMRect): boolean {
  if (typeof window === 'undefined') return true
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth
  )
}

/**
 * Tracks the bounding rect of the first matching element among
 * `targetSelectors` (priority order — earlier selectors win even if a later
 * one also matches) while `active`, updating on resize/scroll. Returns
 * `{ rect: null, matchedSelector: null }` when there are no selectors,
 * `active` is false, or nothing matches — callers should fall back to a
 * non-spotlight (e.g. centered) layout in that case.
 *
 * Fallback selectors exist so steps can still highlight something relevant
 * in states where the primary target is absent (e.g. a brand-new project
 * with zero task rows).
 *
 * An element that matches but reports a zero-size rect (hidden via
 * `display:none`, collapsed, or not yet laid out) is treated as "not
 * matched" — the next selector is tried instead, since a spotlight ring
 * around nothing is worse than falling through to a fallback (or the
 * centered dialog).
 *
 * When the matched selector changes within this step (i.e. hasn't been
 * scrolled-to yet for this step) and the matched element isn't fully inside
 * the viewport, it is scrolled into view once — this keeps mobile spotlight
 * targets reachable instead of leaving the ring off-screen with `scrollY`
 * stuck at 0. The scroll is instant (`behavior: 'auto'`), not smooth: a
 * ~0.5s smooth scroll fights the panel's own position recompute (and its
 * `transition-all`), making both the ring and the panel visibly bounce
 * before settling.
 *
 * The "already scrolled" check is keyed by the matched *selector string*,
 * not the matched *element*: virtualized lists (e.g. the internal task
 * list) recycle DOM nodes as the user scrolls, so the element behind a
 * given selector can be swapped out mid-step. Keying by element would
 * re-trigger `scrollIntoView` for every swap and fight the user's own
 * scrolling; keying by selector scrolls once per step and then leaves
 * scrolling to the user.
 */
export function useSpotlightRect(
  targetSelectors: string | readonly string[] | undefined,
  active: boolean
): SpotlightMatch {
  const [match, setMatch] = useState<SpotlightMatch>(NO_MATCH)
  // 同じステップ内で連続する scroll/resize/mutation 更新のたびに
  // scrollIntoView を呼び直さないよう、直近でスクロール判定済みのセレクタを
  // 覚えておく（要素ではなくセレクタで判定 — 仮想リストは要素を使い回すため）。
  const scrolledSelectorRef = useRef<string | null>(null)

  const selectorKey = (
    typeof targetSelectors === 'string' ? [targetSelectors] : targetSelectors ?? []
  ).join(SEP)

  useEffect(() => {
    // 新しいステップに入るたび、スクロール済み判定をリセットする。
    scrolledSelectorRef.current = null

    const selectors = selectorKey ? selectorKey.split(SEP) : []
    if (!active || selectors.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets to the no-spotlight state when deactivated/selector cleared
      setMatch(NO_MATCH)
      return
    }

    const update = () => {
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (!el) continue
        const rect = el.getBoundingClientRect()
        // 非表示(display:none)・折り畳み・未描画で潰れた要素は「一致なし」
        // として次のセレクタ（フォールバック）にフォールスルーする。
        if (rect.width <= 0 || rect.height <= 0) continue

        setMatch({ rect, matchedSelector: selector })

        if (scrolledSelectorRef.current !== selector) {
          scrolledSelectorRef.current = selector
          if (!isFullyVisible(rect)) {
            // ビューポートより縦に大きい要素は先頭合わせ、それ以外は中央合わせ。
            const block = rect.height > window.innerHeight ? 'start' : 'center'
            // jsdom には scrollIntoView が実装されていないためガードする。
            // smooth だとパネルの位置再計算(と transition-all)と競合して
            // リングごと跳ねて見えるため、即座に移動する。
            el.scrollIntoView?.({ block, behavior: 'auto' })
          }
        }
        return
      }
      setMatch(NO_MATCH)
    }

    // データ読込によるレイアウトシフトや、対象要素の遅延出現でも追従できるよう
    // DOM変化を監視する。rAFでスロットルし、同一フレーム内の連続変化をまとめる。
    let rafId: number | null = null
    const scheduleUpdate = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        update()
      })
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    const observer = new MutationObserver(scheduleUpdate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      observer.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [selectorKey, active])

  return match
}
