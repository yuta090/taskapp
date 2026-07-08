'use client'

import { useEffect, type RefObject } from 'react'

interface UseWalkthroughDismissalArgs {
  isOpen: boolean
  panelRef: RefObject<HTMLElement | null>
  /** CSS selector for the currently spotlighted element, if any. */
  targetSelector: string | undefined
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

/** Arrow-key navigation must not fire while the user is typing in a field
 *  reachable through the spotlight hole. */
function isTypingTarget(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  )
}

/**
 * Keyboard and spotlight-click wiring for an anchored walkthrough step:
 * Esc always closes, arrow keys navigate, and clicking the spotlighted
 * target advances to the next step. Clicks on the dimmed background are
 * handled by WalkthroughBackdrop's own onClick (the dimmed area blocks the
 * UI underneath), not here — this hook only advances on real target clicks.
 */
export function useWalkthroughDismissal({
  isOpen,
  panelRef,
  targetSelector,
  onNext,
  onPrev,
  onClose,
}: UseWalkthroughDismissalArgs): void {
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (isTypingTarget(e.target)) return
      else if (e.key === 'ArrowRight') onNext()
      else if (e.key === 'ArrowLeft') onPrev()
    }

    const handleClick = (e: MouseEvent) => {
      const clickTarget = e.target
      if (!(clickTarget instanceof Node)) return

      // The panel's own buttons handle their own clicks.
      if (panelRef.current?.contains(clickTarget)) return

      const spotlightEl = targetSelector ? document.querySelector(targetSelector) : null
      if (spotlightEl?.contains(clickTarget)) onNext()
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('click', handleClick)
    }
  }, [isOpen, panelRef, targetSelector, onNext, onPrev, onClose])
}
