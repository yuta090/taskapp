'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  House,
  ListChecks,
  CurrencyJpy,
  CalendarDots,
  BookOpen,
  Gear,
} from '@phosphor-icons/react'

interface VendorLeftNavProps {
  spaceId: string | null
  onNavigate?: () => void
}

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
}

export function VendorLeftNav({ spaceId: _spaceId, onNavigate }: VendorLeftNavProps) {
  const pathname = usePathname()

  const navItems: NavItem[] = [
    { href: '/vendor-portal', label: 'ダッシュボード', icon: House },
    { href: '/vendor-portal/tasks', label: 'タスク', icon: ListChecks },
    { href: '/vendor-portal/estimates', label: '見積もり', icon: CurrencyJpy },
    { href: '/vendor-portal/meetings', label: '議事録', icon: CalendarDots },
    { href: '/vendor-portal/wiki', label: 'Wiki', icon: BookOpen },
    { href: '/vendor-portal/settings', label: '設定', icon: Gear },
  ]

  return (
    <nav className="py-4 px-3 space-y-1">
      {navItems.map((item) => {
        const Icon = item.icon
        const isActive = pathname === item.href || (item.href !== '/vendor-portal' && pathname.startsWith(item.href))
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`
              flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors
              ${isActive
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }
            `}
          >
            <Icon
              size={18}
              weight={isActive ? 'fill' : 'regular'}
              className={isActive ? 'text-indigo-600' : 'text-gray-400'}
            />
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
