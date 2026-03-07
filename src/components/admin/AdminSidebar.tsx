'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ChartBar,
  Table,
  Users,
  Buildings,
  FolderSimple,
  EnvelopeSimple,
  CreditCard,
  Key,
  ClockCounterClockwise,
  Bell,
  Megaphone,
  CheckCircle,
  ChartLine,
  TreeStructure,
  PaintBrush,
  PlugsConnected,
  SignOut,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'ダッシュボード', icon: ChartBar, href: '/admin/dashboard' },
  { label: 'テーブルブラウザ', icon: Table, href: '/admin/tables' },
  { label: 'ユーザー管理', icon: Users, href: '/admin/users' },
  { label: '組織管理', icon: Buildings, href: '/admin/organizations' },
  { label: 'スペース', icon: FolderSimple, href: '/admin/spaces' },
  { label: '招待', icon: EnvelopeSimple, href: '/admin/invites' },
  { label: '課金', icon: CreditCard, href: '/admin/billing' },
  { label: 'APIキー', icon: Key, href: '/admin/api-keys' },
  { label: 'ログ', icon: ClockCounterClockwise, href: '/admin/logs' },
  { label: '通知', icon: Bell, href: '/admin/notifications' },
  { label: 'お知らせ', icon: Megaphone, href: '/admin/announcements' },
  { label: 'レビュー', icon: CheckCircle, href: '/admin/reviews' },
  { label: '分析', icon: ChartLine, href: '/admin/analytics' },
  { label: 'サイトマップ', icon: TreeStructure, href: '/admin/sitemap' },
  { label: '外部連携', icon: PlugsConnected, href: '/admin/integrations' },
  { label: 'デザインシステム', icon: PaintBrush, href: '/admin/design-system' },
]

interface AdminSidebarProps {
  unreadCount?: number
}

export function AdminSidebar({ unreadCount }: AdminSidebarProps) {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/admin/login')
  }

  return (
    <aside className="w-60 h-screen bg-white border-r border-gray-200 flex flex-col shrink-0">
      {/* Header */}
      <div className="px-4 py-4 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xs">T</span>
          </div>
          <span className="text-sm font-bold text-gray-900">Admin</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname.startsWith(item.href)
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm transition-colors mb-0.5 ${
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
              {item.label}
              {item.label === '通知' && unreadCount != null && unreadCount > 0 && (
                <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-gray-200">
        <button
          onClick={handleLogout}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 w-full transition-colors"
        >
          <SignOut size={18} />
          ログアウト
        </button>
      </div>
    </aside>
  )
}
