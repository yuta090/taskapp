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

export interface InspectorOptions {
  /** 既定は 400px。'narrow' は 320px（例: Wiki のページ情報パネル） */
  size?: 'default' | 'narrow'
}

interface InspectorContextValue {
  inspector: ReactNode | null
  inspectorSize: 'default' | 'narrow'
  setInspector: (node: ReactNode | null, options?: InspectorOptions) => void
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
  const [inspectorSize, setInspectorSize] = useState<'default' | 'narrow'>('default')
  const setInspector = useCallback(
    (node: ReactNode | null, options?: InspectorOptions) => {
      setInspectorNode(node)
      setInspectorSize(options?.size ?? 'default')
    },
    []
  )
  const contextValue = useMemo(
    () => ({ inspector: inspectorNode, inspectorSize, setInspector }),
    [inspectorNode, inspectorSize, setInspector]
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
  const { inspector, inspectorSize } = useInspector()
  return (
    <aside
      className={`inspector-pane flex-shrink-0 bg-surface ${
        inspector ? 'open' : ''
      } ${inspectorSize === 'narrow' ? 'inspector-narrow' : ''}`}
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
 * - Exception: Wiki のページ情報パネルは 320px（ユーザー要望・2026-09-12）。
 *   setInspector(node, { size: 'narrow' }) で指定する。他のページは 400px のまま。
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

interface ShellFullscreenContextValue {
  /** true のあいだ、デスクトップの LeftNav を隠して本文を画面いっぱいに広げる */
  fullscreen: boolean
  setFullscreen: (value: boolean) => void
}

const ShellFullscreenContext = createContext<ShellFullscreenContextValue | null>(null)

/**
 * ページを画面いっぱいに見せる（Wiki の「全画面」）。重ね表示（fixed）にしないのは、main が
 * `relative z-0` で重なりの箱を作っていて、その中からは LeftNav の上に出られないため
 * （実際に本文の左端が LeftNav に隠れた・2026-09-12）。
 * 使うページは画面を離れるときに必ず false に戻すこと（戻さないとほかの画面で LeftNav が消えたまま）。
 */
export function useShellFullscreen() {
  const context = useContext(ShellFullscreenContext)
  if (!context) {
    throw new Error('useShellFullscreen must be used within AppShell')
  }
  return context
}

export function AppShell({ children }: { children: ReactNode }) {
  // Mobile (<md): LeftNav collapses into a slide-in drawer behind a hamburger.
  // Desktop (md+): unchanged fixed 3-pane.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), [])

  // Wiki の「全画面」。setFullscreen は useState の更新関数なので常に同じ参照
  const [fullscreen, setFullscreen] = useState(false)
  const fullscreenValue = useMemo(() => ({ fullscreen, setFullscreen }), [fullscreen])

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
      <ShellFullscreenContext.Provider value={fullscreenValue}>
      {/* h-[100dvh] avoids the iOS Safari 100vh/url-bar gap on mobile */}
      <div className="flex h-[100dvh] w-full overflow-hidden bg-surface text-gray-900">
        {/* Mobile header bar (md:hidden) — hamburger + title + bell */}
        <div className="md:hidden fixed top-0 left-0 right-0 z-30 h-12 bg-surface/90 backdrop-blur-xl border-b border-gray-200 flex items-center px-4 gap-3">
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
                <Suspense fallback={<div className="w-full h-full bg-gray-50 border-r border-gray-100" />}>
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

        {/* 1) Left Nav - Fixed 240px on desktop, hidden on mobile.
            Wiki の「全画面」（useShellFullscreen）のあいだはデスクトップでも隠す */}
        <Suspense
          fallback={
            <div
              className={
                fullscreen ? 'hidden' : 'hidden md:block w-60 flex-shrink-0 bg-gray-50 border-r border-gray-100'
              }
            />
          }
        >
          <div className={fullscreen ? 'hidden' : 'hidden md:flex'}>
            <LeftNav />
          </div>
        </Suspense>

        {/* 2) Center area - Main + Inspector grouped together */}
        {/* min-w-0 が要る。これが無いと中央エリアが「中身の最小幅」までふくらみ、
            画面より広くなった右端が切り落とされる（ガントで実際に main が 1600px に
            なり、ヘッダー右端のベル・案内文・ビュー切替タブが画面外に出ていた）。
            下限を外せば画面幅に収まり、はみ出しは中身側の overflow で処理される。 */}
        <div className="flex-1 min-w-0 min-h-0 flex justify-center bg-gray-50/50 pt-12 md:pt-0">
          <div className="flex h-full min-h-0 w-full max-w-[1600px]">
            {/* Main Content */}
            <main id="main-content" className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface relative z-0">
              {/* Desktop top bar with announcement bell (mobile bell lives in the header).
                  ページ側のヘッダーが自前でベルを置いている場合（[data-header-bell]）は、
                  globals.css の :has() ルールでこの行ごと消える（重複と余分な1行を避ける）。 */}
              <div data-appshell-bell-row className="hidden md:flex items-center justify-end px-4 py-1.5 flex-shrink-0">
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
      </ShellFullscreenContext.Provider>
    </InspectorProvider>
  )
}
