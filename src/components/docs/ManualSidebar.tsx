'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { List, X } from '@phosphor-icons/react'

interface NavSection {
  title: string
  basePath: string
  items: { href: string; label: string }[]
}

const sections: NavSection[] = [
  {
    title: '開発会社向け',
    basePath: '/docs/manual/internal',
    items: [
      { href: '/docs/manual/internal', label: '概要' },
      { href: '/docs/manual/internal/getting-started', label: 'はじめに・初期設定' },
      { href: '/docs/manual/internal/tasks', label: 'タスク管理' },
      { href: '/docs/manual/internal/meetings', label: '会議管理' },
      { href: '/docs/manual/internal/wiki', label: 'Wiki・仕様管理' },
      { href: '/docs/manual/internal/reviews', label: 'レビュー・承認' },
      { href: '/docs/manual/internal/scheduling', label: '日程調整' },
      { href: '/docs/manual/internal/settings', label: 'プロジェクト設定' },
      { href: '/docs/manual/internal/mcp-guide', label: 'MCP（AI連携）' },
      { href: '/docs/manual/internal/notifications', label: '通知ガイド' },
      { href: '/docs/manual/internal/troubleshooting', label: 'トラブルシューティング' },
      { href: '/docs/manual/internal/glossary', label: '用語集' },
    ],
  },
  {
    title: 'クライアント向け',
    basePath: '/docs/manual/client',
    items: [
      { href: '/docs/manual/client', label: '概要' },
      { href: '/docs/manual/client/getting-started', label: 'はじめに' },
      { href: '/docs/manual/client/dashboard', label: 'ダッシュボード' },
      { href: '/docs/manual/client/tasks', label: 'タスクの確認と対応' },
      { href: '/docs/manual/client/meetings', label: '会議と日程調整' },
      { href: '/docs/manual/client/approvals', label: '承認・レビュー' },
      { href: '/docs/manual/client/troubleshooting', label: 'お困りの場合' },
    ],
  },
]

export function ManualSidebar() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const navContent = (
    <>
      <div className="sticky top-0 bg-gray-50/95 backdrop-blur-sm p-4 border-b border-gray-100 z-10">
        <Link
          href="/docs/manual"
          className="text-base font-bold text-gray-900 hover:text-indigo-600 transition-colors"
          onClick={() => setMobileOpen(false)}
        >
          TaskApp マニュアル
        </Link>
      </div>

      <nav className="p-4 space-y-6">
        {sections.map((section) => {
          const isCurrentSection = pathname.startsWith(section.basePath)
          return (
            <div key={section.basePath}>
              <h3 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2 px-3">
                {section.title}
              </h3>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive = pathname === item.href
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={`
                          block px-3 py-1.5 rounded-md text-sm transition-colors
                          ${isActive
                            ? 'bg-indigo-50 text-indigo-700 font-medium'
                            : isCurrentSection
                              ? 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
                              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                          }
                        `}
                      >
                        {item.label}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>
    </>
  )

  return (
    <>
      {/* Mobile toggle */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 p-2 bg-white border border-gray-200 rounded-lg shadow-sm"
        aria-label="メニューを開く"
      >
        <List className="w-5 h-5 text-gray-600" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div
            className="absolute inset-0 bg-black/20"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-72 bg-gray-50 overflow-y-auto shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600"
              aria-label="メニューを閉じる"
            >
              <X className="w-5 h-5" />
            </button>
            {navContent}
          </aside>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden md:block w-64 shrink-0 border-r border-gray-200 bg-gray-50 overflow-y-auto">
        {navContent}
      </aside>
    </>
  )
}
