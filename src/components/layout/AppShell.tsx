'use client'

import {
  ReactNode,
  Suspense,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
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
  return (
    <InspectorProvider>
      <div className="flex h-screen w-full overflow-hidden bg-white text-gray-900">
        {/* 1) Left Nav - Fixed 240px */}
        <Suspense fallback={<div className="w-60 flex-shrink-0 bg-white border-r border-gray-100" />}>
          <LeftNav />
        </Suspense>

        {/* 2) Center area - Main + Inspector grouped together */}
        <div className="flex-1 min-h-0 flex justify-center bg-gray-50/50">
          <div className="flex h-full min-h-0 w-full max-w-[1600px]">
            {/* Main Content */}
            <main id="main-content" className="flex-1 min-w-0 min-h-0 flex flex-col bg-white relative z-0">
              {/* Top bar with announcement bell */}
              <div className="flex items-center justify-end px-4 py-1.5 flex-shrink-0">
                <AnnouncementBell />
              </div>
              {children}
            </main>

            {/* Inspector - Resizes, never overlays */}
            <InspectorPane />
          </div>
        </div>
      </div>

      <GlobalShortcuts />
      <LastPathRecorder />
    </InspectorProvider>
  )
}
