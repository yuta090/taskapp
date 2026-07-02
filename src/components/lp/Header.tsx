'use client'

import Link from 'next/link'
import { ArrowRight, List, X, CaretDown, Terminal, Briefcase, Buildings, Code, GitBranch, FileText, ChartBar, Shield, CheckCircle, Notebook, TreeStructure, Handshake, Globe, Laptop, UserCircle, ChatCircle, ArrowsLeftRight, Question } from '@phosphor-icons/react'
import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'

/* ─── Menu Data ─── */

interface DropdownItem {
  href: string
  label: string
  desc: string
  icon: ReactNode
}

interface FeatureColumn {
  persona: string
  items: DropdownItem[]
}

const featureColumns: FeatureColumn[] = [
  {
    persona: 'エンジニア向け',
    items: [
      { href: '/features#for-developers', label: 'AI/CLI操作', desc: 'ターミナルから自然言語でタスク管理', icon: <Terminal size={18} weight="duotone" /> },
      { href: '/features#for-developers', label: 'スキル（ワークフロー自動化）', desc: '/project-status, /meeting-flow 等', icon: <Code size={18} weight="duotone" /> },
    ],
  },
  {
    persona: 'PM向け',
    items: [
      { href: '/features#for-everyone', label: 'ボール管理', desc: '「誰待ち？」が常に明確', icon: <GitBranch size={18} weight="duotone" /> },
      { href: '/features#for-everyone', label: 'ダッシュボード', desc: 'タスク・マイルストーン・進捗を一覧', icon: <ChartBar size={18} weight="duotone" /> },
      { href: '/features#for-clients', label: '仕様書・承認証跡の管理', desc: 'Wiki・議事録・レビューが一体で残る', icon: <FileText size={18} weight="duotone" /> },
    ],
  },
  {
    persona: '発注者向け',
    items: [
      { href: '/features#for-clients', label: 'クライアントポータル', desc: 'アカウント不要。URLを開くだけ', icon: <Shield size={18} weight="duotone" /> },
      { href: '/features#for-clients', label: 'バグ報告・要望起票', desc: 'ポータルから直接起票、進捗も追える', icon: <CheckCircle size={18} weight="duotone" /> },
      { href: '/features#for-clients', label: '見積もり承認', desc: 'ワンクリック承認、歩留まりゼロ', icon: <Notebook size={18} weight="duotone" /> },
    ],
  },
  {
    persona: '代理店向け',
    items: [
      { href: '/features#for-agencies', label: '代理店モード', desc: '原価・マージン・売値を一画面管理', icon: <Buildings size={18} weight="duotone" /> },
      { href: '/features#for-agencies', label: '3段階承認フロー', desc: 'ベンダー→代理店→クライアント', icon: <TreeStructure size={18} weight="duotone" /> },
    ],
  },
]

const useCaseItems: DropdownItem[] = [
  { href: '/use-cases#outsourced', label: '受託開発チーム', desc: '要件定義〜納品まで、発注者と一緒に管理', icon: <Handshake size={18} weight="duotone" /> },
  { href: '/use-cases#web', label: 'Web制作会社', desc: '企画〜公開、複数案件を並行管理', icon: <Globe size={18} weight="duotone" /> },
  { href: '/use-cases#freelance', label: 'フリーランスエンジニア', desc: '見積もり・請求・進捗報告を1ツールで', icon: <Laptop size={18} weight="duotone" /> },
  { href: '/use-cases#agency', label: '代理店（制作会社管理）', desc: '原価管理＋クライアント向け売値表示', icon: <Briefcase size={18} weight="duotone" /> },
]

const supportItems: DropdownItem[] = [
  { href: '/contact', label: '導入相談', desc: '無料でチームに合った運用を提案', icon: <UserCircle size={18} weight="duotone" /> },
  { href: '/contact#chat', label: 'チャットサポート', desc: '使い方の質問に即対応', icon: <ChatCircle size={18} weight="duotone" /> },
  { href: '/contact#migration', label: '移行サポート', desc: 'Backlog等からの移行をお手伝い', icon: <ArrowsLeftRight size={18} weight="duotone" /> },
  { href: '/#faq', label: 'よくある質問', desc: '導入・料金・セキュリティ等', icon: <Question size={18} weight="duotone" /> },
]

/* ─── Dropdown wrapper (desktop) ─── */

function NavDropdown({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setOpen(true)
  }, [])

  const handleLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setOpen(false), 150)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div
      ref={containerRef}
      className="relative"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 text-sm font-medium transition-colors ${open ? 'text-amber-600' : 'text-slate-600 hover:text-slate-900'}`}
        aria-expanded={open}
      >
        {label}
        <CaretDown size={12} weight="bold" className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          className={`absolute top-full left-1/2 pt-3 ${wide ? '-translate-x-1/2' : '-translate-x-1/2'}`}
          style={wide ? { width: 'min(56rem, 90vw)' } : { width: '20rem' }}
        >
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Simple list dropdown ─── */

function SimpleDropdownList({ items, onNavigate }: { items: DropdownItem[]; onNavigate?: () => void }) {
  return (
    <div className="p-2">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          onClick={onNavigate}
          className="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
        >
          <span className="mt-0.5 text-slate-400 group-hover:text-amber-500 transition-colors">{item.icon}</span>
          <div>
            <div className="text-sm font-medium text-slate-700 group-hover:text-amber-600 transition-colors">{item.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{item.desc}</div>
          </div>
        </Link>
      ))}
    </div>
  )
}

/* ─── Mega menu for features ─── */

function FeaturesMegaMenu() {
  return (
    <div className="p-4">
      <div className="grid grid-cols-4 gap-4">
        {featureColumns.map((col) => (
          <div key={col.persona}>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 pb-1 border-b-2 border-amber-500/30">
              {col.persona}
            </div>
            <div className="space-y-1">
              {col.items.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-start gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors group"
                >
                  <span className="mt-0.5 text-slate-400 group-hover:text-amber-500 transition-colors shrink-0">{item.icon}</span>
                  <div>
                    <div className="text-sm font-medium text-slate-700 group-hover:text-amber-600 transition-colors">{item.label}</div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.desc}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 border-t border-slate-100">
        <Link href="/features" className="flex items-center gap-1 text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors px-2">
          全機能一覧
          <ArrowRight weight="bold" size={14} />
        </Link>
      </div>
    </div>
  )
}

/* ─── Mobile accordion ─── */

function MobileAccordion({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
        aria-expanded={open}
      >
        {label}
        <CaretDown size={14} weight="bold" className={`text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="pl-4 pb-2">
          {children}
        </div>
      )}
    </div>
  )
}

function MobileMegaMenu({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-2">
      {featureColumns.map((col) => (
        <div key={col.persona}>
          <div className="text-xs font-bold text-slate-400 uppercase tracking-wider px-4 py-1">{col.persona}</div>
          {col.items.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              onClick={onClose}
              className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-600 hover:text-amber-600 hover:bg-slate-50 rounded-lg transition-colors"
            >
              <span className="text-slate-400">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      ))}
      <Link
        href="/features"
        onClick={onClose}
        className="flex items-center gap-1 px-4 py-2 text-sm font-medium text-amber-600"
      >
        全機能一覧 <ArrowRight weight="bold" size={14} />
      </Link>
    </div>
  )
}

function MobileSimpleList({ items, onClose }: { items: DropdownItem[]; onClose: () => void }) {
  return (
    <div>
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          onClick={onClose}
          className="flex items-center gap-2.5 px-4 py-2 text-sm text-slate-600 hover:text-amber-600 hover:bg-slate-50 rounded-lg transition-colors"
        >
          <span className="text-slate-400">{item.icon}</span>
          {item.label}
        </Link>
      ))}
    </div>
  )
}

/* ─── Main Header ─── */

export function LPHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)

  const close = useCallback(() => setMobileOpen(false), [])

  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [mobileOpen, close])

  return (
    <>
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
        <div className="container mx-auto px-6 h-16 flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 mr-8 shrink-0">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="font-bold text-xl text-slate-900 tracking-tight">AgentPM</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center gap-6 flex-1">
            <NavDropdown label="機能" wide>
              <FeaturesMegaMenu />
            </NavDropdown>

            <NavDropdown label="活用シーン">
              <SimpleDropdownList items={useCaseItems} />
            </NavDropdown>

            <Link href="/pricing" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              料金
            </Link>

            <Link href="/compare" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
              競合比較
            </Link>

            <NavDropdown label="サポート">
              <SimpleDropdownList items={supportItems} />
            </NavDropdown>
          </nav>

          {/* Right side: Login + Signup */}
          <div className="flex items-center gap-3 shrink-0">
            <Link
              href="/login"
              className="hidden lg:inline-flex px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="hidden sm:inline-flex px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 transition-colors items-center gap-1"
            >
              無料で始める
              <ArrowRight weight="bold" size={14} />
            </Link>

            {/* Mobile hamburger */}
            <button
              className="lg:hidden p-2 text-slate-700 hover:text-slate-900"
              onClick={() => setMobileOpen(true)}
              aria-label="メニューを開く"
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-drawer"
            >
              <List size={24} weight="bold" />
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60]">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={close} />

          {/* Drawer */}
          <nav
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="メニュー"
            className="absolute right-0 top-0 h-full w-80 bg-white shadow-2xl flex flex-col overflow-y-auto"
          >
            <div className="flex items-center justify-between px-6 h-16 border-b border-slate-100 shrink-0">
              <span className="font-bold text-lg text-slate-900">メニュー</span>
              <button onClick={close} className="p-2 text-slate-500 hover:text-slate-900" aria-label="閉じる">
                <X size={20} weight="bold" />
              </button>
            </div>

            <div className="flex flex-col gap-1 p-4 flex-1">
              <MobileAccordion label="機能">
                <MobileMegaMenu onClose={close} />
              </MobileAccordion>

              <MobileAccordion label="活用シーン">
                <MobileSimpleList items={useCaseItems} onClose={close} />
              </MobileAccordion>

              <Link
                href="/pricing"
                onClick={close}
                className="px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
              >
                料金
              </Link>

              <Link
                href="/compare"
                onClick={close}
                className="px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
              >
                競合比較
              </Link>

              <MobileAccordion label="サポート">
                <MobileSimpleList items={supportItems} onClose={close} />
              </MobileAccordion>

              <Link
                href="/login"
                onClick={close}
                className="px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
              >
                ログイン
              </Link>
            </div>

            <div className="p-4 border-t border-slate-100 shrink-0">
              <Link
                href="/signup"
                onClick={close}
                className="flex items-center justify-center gap-2 w-full px-4 py-3 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 transition-colors"
              >
                無料で始める
                <ArrowRight weight="bold" size={16} />
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  )
}
