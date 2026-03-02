import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

interface UseFocusTrapOptions {
  /** Whether the trap is active (set to isOpen) */
  enabled?: boolean
  onClose?: () => void
  /** Skip auto-focus on mount (use when the component manages its own focus) */
  skipAutoFocus?: boolean
}

/**
 * Traps focus within a container element.
 * - Tab/Shift+Tab cycles within the container
 * - Escape calls onClose
 * - Returns focus to the previously focused element when disabled/unmounted
 */
export function useFocusTrap<T extends HTMLElement>(options: UseFocusTrapOptions = {}) {
  const { enabled = true, onClose, skipAutoFocus } = options
  const containerRef = useRef<T>(null)
  const previousFocusRef = useRef<Element | null>(null)

  // Capture previous focus and optionally auto-focus first element
  useEffect(() => {
    if (!enabled) return

    previousFocusRef.current = document.activeElement

    if (!skipAutoFocus) {
      const frame = requestAnimationFrame(() => {
        const container = containerRef.current
        if (!container) return
        const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        first?.focus()
      })
      return () => cancelAnimationFrame(frame)
    }
  }, [enabled, skipAutoFocus])

  // Return focus when disabled or unmounted
  useEffect(() => {
    if (!enabled) {
      const prev = previousFocusRef.current
      if (prev instanceof HTMLElement) {
        prev.focus()
      }
      previousFocusRef.current = null
    }
  }, [enabled])

  // Tab trap + Escape handler
  useEffect(() => {
    if (!enabled) return

    const container = containerRef.current
    if (!container) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose?.()
        return
      }

      if (e.key !== 'Tab') return

      const focusable = container!.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      // If focus is outside container, bring it back
      if (!container!.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
        return
      }

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [enabled, onClose])

  return containerRef
}
