'use client'

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { PortalLeftNav } from './PortalLeftNav'

interface PortalShellProps {
  children: ReactNode
  inspector?: ReactNode
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
 * Mirrors the internal AppShell design for consistency.
 */
export function PortalShell({
  children,
  inspector,
  currentProject,
  projects,
  actionCount = 0,
}: PortalShellProps) {
  const [inspectorNode, setInspectorNode] = useState<ReactNode | null>(null)
  const resolvedInspector = inspector ?? inspectorNode

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

  const contextValue = useMemo(
    () => ({ inspector: inspectorNode, setInspector: setInspectorNode }),
    [inspectorNode]
  )

  return (
    <InspectorContext.Provider value={contextValue}>
      <div className="flex h-screen w-full overflow-hidden bg-[#F0F4F8] text-gray-900 relative selection:bg-indigo-500/30 font-sans">

        {/* Aurora Background Layer */}
        <div className="fixed inset-0 z-0 pointer-events-none opacity-60">
          <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-purple-300 rounded-full blur-[120px] mix-blend-multiply filter animate-pulse-slow"></div>
          <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-indigo-300 rounded-full blur-[120px] mix-blend-multiply filter animate-pulse-slow animation-delay-2000"></div>
          <div className="absolute bottom-[-20%] left-[20%] w-[50%] h-[50%] bg-blue-200 rounded-full blur-[120px] mix-blend-multiply filter animate-pulse-slow animation-delay-4000"></div>
        </div>

        {/* 1) Left Nav - Fixed 240px */}
        {/* Note: PortalLeftNav might need internal updates for glassmorphism, but rendering it here is fine. */}
        <PortalLeftNav
          currentProject={currentProject}
          projects={projects}
          actionCount={actionCount}
        />

        {/* 2) Center area - Main + Inspector grouped together */}
        <div className="flex-1 min-h-0 flex justify-center bg-transparent z-10">
          <div className="flex h-full min-h-0 w-full max-w-[1720px] lg:px-6 lg:py-4">
            {/* Main Content */}
            <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-transparent relative z-0">
              {children}
            </main>

            {/* Inspector - Resizes, never overlays */}
            {shouldRender && (
              <aside
                className={`w-[400px] 2xl:w-[440px] flex-shrink-0 bg-white/90 backdrop-blur-xl border border-white/50 shadow-2xl rounded-2xl ml-4 overflow-y-auto mb-4 transition-all duration-300 ease-out ${
                  isVisible
                    ? 'opacity-100 translate-x-0'
                    : 'opacity-0 translate-x-8'
                }`}
              >
                {resolvedInspector}
              </aside>
            )}
          </div>
        </div>
      </div>
    </InspectorContext.Provider>
  )
}
