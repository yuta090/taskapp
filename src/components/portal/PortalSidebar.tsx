'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  House,
  Lightning,
  ListChecks,
  Folder,
  NotePencil,
  CheckSquare,
  CalendarCheck,
  Gear,
  CaretLeft,
  CaretRight,
} from '@phosphor-icons/react'
import { useState } from 'react'

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  badge?: number
}

interface PortalSidebarProps {
  actionCount?: number
  className?: string
}

export function PortalSidebar({ actionCount = 0, className = '' }: PortalSidebarProps) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  const navItems: NavItem[] = [
    { href: '/portal', label: 'ダッシュボード', icon: House },
    { href: '/portal/tasks', label: '要対応', icon: Lightning, badge: actionCount > 0 ? actionCount : undefined },
    { href: '/portal/all-tasks', label: 'タスク一覧', icon: ListChecks },
    { href: '/portal/files', label: 'ファイル', icon: Folder },
    { href: '/portal/meetings', label: '議事録', icon: NotePencil },
    { href: '/portal/history', label: '承認履歴', icon: CheckSquare },
    { href: '/portal/scheduling', label: '日程調整', icon: CalendarCheck },
  ]

  const bottomItems: NavItem[] = [
    { href: '/portal/settings', label: '設定', icon: Gear },
  ]

  const isActive = (href: string) => {
    if (href === '/portal') {
      return pathname === '/portal'
    }
    return pathname.startsWith(href)
  }

  return (
    <aside
      className={`
        ${collapsed ? 'w-16' : 'w-60'}
        flex flex-col bg-white border-r border-gray-200
        transition-all duration-200 ease-in-out
        ${className}
      `}
    >
      {/* Logo area */}
      <div className="h-14 flex items-center px-4 border-b border-gray-100">
        {!collapsed && (
          <Link href="/portal" className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">TA</span>
            </div>
            <span className="text-lg font-bold text-gray-900">TaskApp</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/portal" className="mx-auto">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">TA</span>
            </div>
          </Link>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                ${active
                  ? 'bg-amber-50 text-amber-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }
                ${collapsed ? 'justify-center' : ''}
              `}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-amber-600' : ''}`} />
              {!collapsed && (
                <>
                  <span className="text-sm font-medium flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-amber-500 text-white rounded-full">
                      {item.badge}
                    </span>
                  )}
                </>
              )}
              {collapsed && item.badge && (
                <span className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full" />
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom navigation */}
      <div className="px-3 py-4 border-t border-gray-100 space-y-1">
        {bottomItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                ${active
                  ? 'bg-amber-50 text-amber-700'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }
                ${collapsed ? 'justify-center' : ''}
              `}
              title={collapsed ? item.label : undefined}
            >
              <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-amber-600' : ''}`} />
              {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
            </Link>
          )
        })}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={`
            flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full
            text-gray-400 hover:text-gray-600 hover:bg-gray-100
            ${collapsed ? 'justify-center' : ''}
          `}
        >
          {collapsed ? (
            <CaretRight className="w-5 h-5" />
          ) : (
            <>
              <CaretLeft className="w-5 h-5" />
              <span className="text-sm">折りたたむ</span>
            </>
          )}
        </button>
      </div>
    </aside>
  )
}
