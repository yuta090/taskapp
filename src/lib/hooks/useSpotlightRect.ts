'use client'

import { useEffect, useState } from 'react'

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
 */
export function useSpotlightRect(
  targetSelectors: string | readonly string[] | undefined,
  active: boolean
): SpotlightMatch {
  const [match, setMatch] = useState<SpotlightMatch>(NO_MATCH)

  const selectorKey = (
    typeof targetSelectors === 'string' ? [targetSelectors] : targetSelectors ?? []
  ).join(SEP)

  useEffect(() => {
    const selectors = selectorKey ? selectorKey.split(SEP) : []
    if (!active || selectors.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets to the no-spotlight state when deactivated/selector cleared
      setMatch(NO_MATCH)
      return
    }

    const update = () => {
      for (const selector of selectors) {
        const el = document.querySelector(selector)
        if (el) {
          setMatch({ rect: el.getBoundingClientRect(), matchedSelector: selector })
          return
        }
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
