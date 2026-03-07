'use client'

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { List, X } from '@phosphor-icons/react'
import { PortalLeftNav } from './PortalLeftNav'

interface PortalShellProps {
  children: ReactNode
  inspector?: ReactNode
  onInspectorClose?: () => void
  currentProject?: {
    id: string
    name: string
    orgId: string
    orgName?: string
  }
  projects?: {
    id: string
    name: string
    orgId: string
    orgName?: string
  }[]
  actionCount?: number
}

interface InspectorContextValue {
  inspector: ReactNode | null
  setInspector: (node: ReactNode | null) => void
}

const InspectorContext = createContext<InspectorContextValue | null>(null)

export function usePortalInspector() {
  const context = useContext(InspectorContext)
  if (!context) {
    throw new Error('usePortalInspector must be used within PortalShell')
  }
  return context
}

/**
 * Portal 3-Pane Layout: [Left Nav: 240px] - [Main: flex-1] - [Inspector: 400px]
 *
 * Desktop: 3-pane side-by-side
 * Mobile: Hamburger nav + full-screen inspector overlay
 */
export function PortalShell({
  children,
  inspector,
  onInspectorClose,
  currentProject,
  projects,
  actionCount = 0,
}: PortalShellProps) {
  const [inspectorNode, setInspectorNode] = useState<ReactNode | null>(null)
  const resolvedInspector = inspector ?? inspectorNode
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  // Unified close handler for both controlled (inspector prop) and uncontrolled (context) modes
  const handleInspectorClose = useCallback(() => {
    if (onInspectorClose) {
      onInspectorClose()
    }
    setInspectorNode(null)
  }, [onInspectorClose])

  // Animation state for slide in/out
  const [isVisible, setIsVisible] = useState(false)
  const [shouldRender, setShouldRender] = useState(false)
  const animationRef = useRef<number | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Cleanup previous animations
    if (animationRef.current) cancelAnimationFrame(animationRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    if (resolvedInspector) {
      // Opening: render first, then animate in after browser paint
      // eslint-disable-next-line react-hooks/set-state-in-effect -- animation state management
      setShouldRender(true)
      // Double rAF ensures browser has painted the initial state
      animationRef.current = requestAnimationFrame(() => {
        animationRef.current = requestAnimationFrame(() => {
          setIsVisible(true)
        })
      })
    } else {
      // Closing: animate out first, then unmount
      setIsVisible(false)
      timeoutRef.current = setTimeout(() => setShouldRender(false), 300)
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [resolvedInspector])

  // Close mobile nav
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  // Escape key handler for overlays
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (mobileNavOpen) {
        setMobileNavOpen(false)
      } else if (resolvedInspector) {
        handleInspectorClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [mobileNavOpen, resolvedInspector, handleInspectorClose])

  const contextValue = useMemo(
    () => ({ inspector: inspectorNode, setInspector: setInspectorNode }),
    [inspectorNode]
  )

  return (
    <InspectorContext.Provider value={contextValue}>
      <div className="flex h-screen w-full overflow-hidden bg-gray-100 text-gray-900 selection:bg-indigo-500/30 font-sans">

        {/* Mobile header bar */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 bg-white/90 backdrop-blur-xl border-b border-gray-200 flex items-center px-4 gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100"
            aria-label="メニューを開く"
          >
            <List className="text-xl" weight="bold" />
          </button>
          <span className="text-sm font-medium text-gray-900 truncate">
            {currentProject?.name || 'TaskApp'}
          </span>
        </div>

        {/* Mobile nav overlay */}
        {mobileNavOpen && (
          <>
            <div
              className="md:hidden fixed inset-0 z-40 bg-black/30"
              onClick={closeMobileNav}
            />
            <div className="md:hidden fixed inset-y-0 left-0 z-50 w-[280px]" role="dialog" aria-modal="true" aria-label="ナビゲーションメニュー">
              <div className="relative h-full">
                <PortalLeftNav
                  currentProject={currentProject}
                  projects={projects}
                  actionCount={actionCount}
                />
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

        {/* 1) Left Nav - Hidden on mobile, fixed on desktop */}
        <div className="hidden md:flex">
          <PortalLeftNav
            currentProject={currentProject}
            projects={projects}
            actionCount={actionCount}
          />
        </div>

        {/* 2) Center area - Main + Inspector grouped together */}
        <div className="flex-1 min-h-0 flex justify-center pt-12 md:pt-0">
          <div className="flex h-full min-h-0 w-full max-w-[1720px] lg:px-6 lg:py-4">
            {/* Main Content */}
            <main id="main-content" className="flex-1 min-w-0 min-h-0 flex flex-col">
              {children}
            </main>

            {/* Inspector - Desktop: side panel, Mobile: full-screen overlay */}
            {shouldRender && (
              <>
                {/* Mobile overlay backdrop */}
                <div
                  className={`md:hidden fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${
                    isVisible ? 'opacity-100' : 'opacity-0'
                  }`}
                  onClick={handleInspectorClose}
                />
                <aside
                  role="dialog"
                  aria-modal="true"
                  aria-label="詳細パネル"
                  className={`
                    fixed inset-0 z-50 bg-white overflow-y-auto
                    md:static md:z-auto md:bg-white/90 md:backdrop-blur-xl md:border md:border-white/50
                    md:shadow-2xl md:rounded-2xl md:ml-4 md:mb-4
                    md:w-[400px] 2xl:md:w-[440px] md:flex-shrink-0
                    transition-all duration-300 ease-out ${
                    isVisible
                      ? 'opacity-100 translate-x-0'
                      : 'opacity-0 translate-x-full md:translate-x-8'
                  }`}
                >
                  {resolvedInspector}
                </aside>
              </>
            )}
          </div>
        </div>
      </div>
    </InspectorContext.Provider>
  )
}
