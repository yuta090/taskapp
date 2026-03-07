'use client'

import Link from 'next/link'
import { ArrowRight, List, X } from '@phosphor-icons/react'
import { useState, useEffect, useCallback } from 'react'

const navLinks = [
  { href: '/#features', label: '機能' },
  { href: '/pricing', label: '料金プラン' },
  { href: '/contact', label: 'お問い合わせ' },
]

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
          <Link href="/" className="flex items-center gap-2 mr-8">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
              <span className="text-white font-bold text-sm">A</span>
            </div>
            <span className="font-bold text-xl text-slate-900 tracking-tight">AgentPM</span>
          </Link>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-8 flex-1">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href} className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right side: Login + Signup */}
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="hidden md:inline-flex px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
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
              className="md:hidden p-2 text-slate-700 hover:text-slate-900"
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
            className="absolute right-0 top-0 h-full w-72 bg-white shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-6 h-16 border-b border-slate-100">
              <span className="font-bold text-lg text-slate-900">メニュー</span>
              <button onClick={close} className="p-2 text-slate-500 hover:text-slate-900" aria-label="閉じる">
                <X size={20} weight="bold" />
              </button>
            </div>

            <div className="flex flex-col gap-1 p-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={close}
                  className="px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/login"
                onClick={close}
                className="px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
              >
                ログイン
              </Link>
            </div>

            <div className="mt-auto p-4 border-t border-slate-100">
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
