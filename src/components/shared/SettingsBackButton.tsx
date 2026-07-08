'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from '@phosphor-icons/react'

interface SettingsBackButtonProps {
  /** Where to navigate when there is no browser history to go back to. */
  fallbackHref?: string
  className?: string
}

const DEFAULT_CLASSNAME =
  'p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors'

/**
 * Back button for settings pages. Prefers browser history (router.back()) so
 * users return to wherever they came from (e.g. a project page), falling back
 * to `fallbackHref` when the tab was opened directly (no history to go back to).
 */
export function SettingsBackButton({
  fallbackHref = '/inbox',
  className = DEFAULT_CLASSNAME,
}: SettingsBackButtonProps) {
  const router = useRouter()

  const handleClick = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push(fallbackHref)
    }
  }

  return (
    <button type="button" onClick={handleClick} aria-label="戻る" className={className}>
      <ArrowLeft className="w-5 h-5" aria-hidden="true" />
    </button>
  )
}
