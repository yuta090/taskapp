'use client'

import Link from 'next/link'
import { ArrowRight } from '@phosphor-icons/react'

export function LPHeader() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200/50">
      <div className="container mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-8">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
            <span className="text-white font-bold text-sm">T</span>
          </div>
          <span className="font-bold text-xl text-slate-900 tracking-tight">TaskApp</span>
        </Link>

        {/* Navigation */}
        <nav className="hidden md:flex items-center gap-8 flex-1">
          <Link href="/#features" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            機能
          </Link>
          <Link href="/pricing" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            料金プラン
          </Link>
          <Link href="/contact" className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors">
            お問い合わせ
          </Link>
        </nav>

        {/* Right side: Login + Signup */}
        <div className="flex items-center gap-6">
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <Link href="/pricing" className="hover:text-amber-600 transition-colors">
              料金プラン
            </Link>
          </nav>
          <div className="h-4 w-px bg-slate-200 hidden md:block"></div>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              ログイン
            </Link>
            <Link
              href="/signup"
              className="px-4 py-2 bg-amber-500 text-white text-sm font-bold rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1"
            >
              無料で始める
              <ArrowRight weight="bold" size={14} />
            </Link>
          </div>
        </div>
      </div>
    </header>
  )
}
