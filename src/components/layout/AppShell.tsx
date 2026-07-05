'use client'

import {
  ReactNode,
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { List, X } from '@phosphor-icons/react'
import { LeftNav } from './LeftNav'
import { useShortcutsHelp } from '@/components/shared/KeyboardShortcutsHelp'
import { useCommandPalette } from '@/components/shared/CommandPalette'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'

const LAST_PATH_KEY = 'taskapp:lastPath'

interface InspectorContextValue {
  inspector: ReactNode | null
  setInspector: (node: ReactNode | null) => void
}

const InspectorContext = createContext<InspectorContextValue | null>(null)

export function useInspector() {
  const context = useContext(InspectorContext)
  if (!context) {
    throw new Error('useInspector must be used within AppShell')
  }
  return context
}

/**
 * InspectorProvider holds the inspector state and provides context.
 * Only InspectorPane subscribes — LeftNav and main content are unaffected.
 */
function InspectorProvider({ children }: { children: ReactNode }) {
  const [inspectorNode, setInspectorNode] = useState<ReactNode | null>(null)
  const contextValue = useMemo(
    () => ({ inspector: inspectorNode, setInspector: setInspectorNode }),
    [inspectorNode]
  )
  return (
    <InspectorContext.Provider value={contextValue}>
      {children}
    </InspectorContext.Provider>
  )
}

/**
 * InspectorPane subscribes to InspectorContext — only this component
 * re-renders when the inspector content changes.
 */
function InspectorPane() {
  const { inspector } = useInspector()
  return (
    <aside
      className={`inspector-pane flex-shrink-0 bg-white ${
        inspector ? 'open' : ''
      }`}
    >
      {inspector}
    </aside>
  )
}

/**
 * 3-Pane Layout: [Left Nav: 240px] - [Main: flex-1] - [Inspector: 400px]
 *
 * UI Rules:
 * - Inspector must resize Main, never overlay
 * - Inspector width: 400px (1920px+: 440px, 2560px+: 480px)
 */
function GlobalShortcuts() {
  const { ShortcutsHelp } = useShortcutsHelp()
  const { CommandPalette } = useCommandPalette()
  return (
    <>
      {ShortcutsHelp}
      {CommandPalette}
    </>
  )
}

function LastPathRecorder() {
  const pathname = usePathname()
  useEffect(() => {
    if (pathname) {
      localStorage.setItem(LAST_PATH_KEY, pathname)
    }
  }, [pathname])
  return null
}

export function AppShell({ children }: { children: ReactNode }) {
  // Mobile (<md): LeftNav collapses into a slide-in drawer behind a hamburger.
  // Desktop (md+): unchanged fixed 3-pane.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  // Escape closes the mobile drawer
  useEffect(() => {
    if (!mobileNavOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen])

  return (
    <InspectorProvider>
      {/* h-[100dvh] avoids the iOS Safari 100vh/url-bar gap on mobile */}
      <div className="flex h-[100dvh] w-full overflow-hidden bg-white text-gray-900">
        {/* Mobile header bar (md:hidden) — hamburger + title + bell */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 bg-white/90 backdrop-blur-xl border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label="メニューを開く"
          >
            <List className="text-xl" weight="bold" />
          </button>
          <span className="text-sm font-medium text-gray-900 truncate flex-1">AgentPM</span>
          <AnnouncementBell />
        </div>

        {/* Mobile nav drawer (md:hidden) */}
        {mobileNavOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 z-40 bg-black/30"
              onClick={closeMobileNav}
            />
            <div
              className="md:hidden fixed inset-y-0 left-0 z-50 w-[280px]"
              role="dialog"
              aria-modal="true"
              aria-label="ナビゲーションメニュー"
              onClick={closeMobileNav}
            >
              <div className="relative h-full">
                <Suspense fallback={<div className="w-full h-full bg-white border-r border-gray-100" />}>
                  <LeftNav />
                </Suspense>
                <button
                  type="button"
                  onClick={closeMobileNav}
                  className="absolute top-3 right-3 p-1 rounded-lg text-gray-500 hover:bg-gray-100 z-10"
                  aria-label="メニューを閉じる"
                >
                  <X className="text-lg" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* 1) Left Nav - Fixed 240px on desktop, hidden on mobile */}
        <Suspense fallback={<div className="hidden md:block w-60 flex-shrink-0 bg-white border-r border-gray-100" />}>
          <div className="hidden md:flex">
            <LeftNav />
          </div>
        </Suspense>

        {/* 2) Center area - Main + Inspector grouped together */}
        <div className="flex-1 min-h-0 flex justify-center bg-gray-50/50 pt-12 md:pt-0">
          <div className="flex h-full min-h-0 w-full max-w-[1600px]">
            {/* Main Content */}
            <main id="main-content" className="flex-1 min-w-0 min-h-0 flex flex-col bg-white relative z-0">
              {/* Desktop top bar with announcement bell (mobile bell lives in the header) */}
              <div className="hidden md:flex items-center justify-end px-4 py-1.5 flex-shrink-0">
                <AnnouncementBell />
              </div>
              {children}
            </main>

            {/* Inspector - Desktop: resizes main, never overlays. Mobile: full-screen sheet (see .inspector-pane in globals.css) */}
            <InspectorPane />
          </div>
        </div>
      </div>

      <GlobalShortcuts />
      <LastPathRecorder />
    </InspectorProvider>
  )
}
