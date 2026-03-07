'use client'

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { List, X } from '@phosphor-icons/react'
import { VendorLeftNav } from './VendorLeftNav'

interface VendorPortalShellProps {
  children: ReactNode
  inspector?: ReactNode
  onInspectorClose?: () => void
  currentProject?: {
    id: string
    name: string
    orgId: string
    orgName?: string
  }
  actionCount?: number
}

interface InspectorContextValue {
  inspector: ReactNode | null
  setInspector: (node: ReactNode | null) => void
}

const InspectorContext = createContext<InspectorContextValue | null>(null)

export function useVendorInspector() {
  const context = useContext(InspectorContext)
  if (!context) {
    throw new Error('useVendorInspector must be used within VendorPortalShell')
  }
  return context
}

export function VendorPortalShell({
  children,
  inspector,
  onInspectorClose,
  currentProject,
  actionCount,
}: VendorPortalShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [internalInspector, setInternalInspector] = useState<ReactNode | null>(null)

  const activeInspector = inspector ?? internalInspector
  const handleClose = useCallback(() => {
    onInspectorClose?.()
    setInternalInspector(null)
  }, [onInspectorClose])

  const inspectorValue = useMemo(
    () => ({ inspector: activeInspector, setInspector: setInternalInspector }),
    [activeInspector]
  )

  const navRef = useRef<HTMLDivElement>(null)

  return (
    <InspectorContext.Provider value={inspectorValue}>
      <div className="h-screen flex flex-col bg-gray-50">
        {/* Header */}
        <header className="h-12 flex-shrink-0 border-b border-gray-200 bg-white flex items-center px-4 gap-3">
          {/* Mobile hamburger */}
          <button
            className="md:hidden p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
          >
            {mobileNavOpen ? <X size={20} /> : <List size={20} />}
          </button>
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center">
              <span className="text-white font-bold text-[10px]">TA</span>
            </div>
            <span className="text-sm font-semibold text-gray-900 hidden sm:inline">TaskApp</span>
            <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-medium rounded">
              Vendor
            </span>
          </div>
          {/* Project name */}
          {currentProject && (
            <div className="ml-2 text-sm text-gray-600 truncate">
              {currentProject.name}
            </div>
          )}
          {actionCount != null && actionCount > 0 && (
            <span className="ml-auto px-2 py-0.5 bg-indigo-500 text-white text-xs font-medium rounded-full">
              {actionCount}
            </span>
          )}
        </header>

        <div className="flex-1 min-h-0 flex">
          {/* Mobile nav overlay */}
          {mobileNavOpen && (
            <div
              className="fixed inset-0 bg-black/30 z-40 md:hidden"
              onClick={() => setMobileNavOpen(false)}
            />
          )}
          {/* Left Nav */}
          <div
            ref={navRef}
            className={`
              w-[240px] flex-shrink-0 bg-white border-r border-gray-200 overflow-y-auto
              md:relative md:block
              ${mobileNavOpen ? 'fixed inset-y-0 left-0 z-50 pt-12' : 'hidden md:block'}
            `}
          >
            <VendorLeftNav
              spaceId={currentProject?.id ?? null}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>

          {/* Main */}
          <main className="flex-1 min-w-0 overflow-y-auto">
            {children}
          </main>

          {/* Inspector */}
          {activeInspector && (
            <>
              {/* Mobile: full-screen overlay */}
              <div className="fixed inset-0 bg-white z-50 md:hidden overflow-y-auto">
                <div className="sticky top-0 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                  <span className="text-sm font-medium text-gray-700">詳細</span>
                  <button
                    onClick={handleClose}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md"
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="p-4">{activeInspector}</div>
              </div>
              {/* Desktop: right panel */}
              <aside className="hidden md:block w-[400px] flex-shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
                <div className="sticky top-0 flex items-center justify-between px-4 py-2 bg-white border-b border-gray-100">
                  <span className="text-xs font-medium text-gray-500">詳細</span>
                  <button
                    onClick={handleClose}
                    className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="p-4">{activeInspector}</div>
              </aside>
            </>
          )}
        </div>
      </div>
    </InspectorContext.Provider>
  )
}
