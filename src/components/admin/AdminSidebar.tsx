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
  Terminal,
  Article,
  ChatCircle,
  SignOut,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

/**
 * 運営(superadmin)パネルのナビゲーション。
 *
 * 体系は「業務フロー×頻度」（Fable裁定 2026-07-22）。19項目がフラットに並んでいて
 * 到達が遅かったのを4群に構造化する。問題の実体は項目数ではなく**無構造**だったため、
 * ページの統廃合・削除はしない（URLは1つも変えない＝メール内の直リンクを壊さない）。
 *
 * 並びの原則は既存方針どおり **メニュー順＝使用頻度**。最上段は「共通LINE開通待ち」＝
 * 収益の律速（顧客が申し込んでも運営が承認するまで製品が動かない）。申込通知メールからの
 * 直リンクが主経路になるが、最上段＋件数バッジは**メールを見落とした申込の安全網**を兼ねる。
 *
 * 折りたたみ・動的な「今やること」セクションは意図的に入れない（利用者2名の運用では
 * 維持されず腐るため。キューの可視化は件数バッジで足りる）。
 */
const NAV_GROUPS: {
  heading: string
  items: { label: string; icon: typeof ChartBar; href: string }[]
}[] = [
  {
    heading: '運用',
    items: [
      { label: '共通LINE開通', icon: ChatCircle, href: '/admin/shared-bot-access' },
      { label: 'ダッシュボード', icon: ChartBar, href: '/admin/dashboard' },
      { label: 'レビュー', icon: CheckCircle, href: '/admin/reviews' },
      { label: '通知', icon: Bell, href: '/admin/notifications' },
      { label: 'ログ', icon: ClockCounterClockwise, href: '/admin/logs' },
    ],
  },
  {
    heading: '顧客',
    items: [
      { label: '組織管理', icon: Buildings, href: '/admin/organizations' },
      { label: '課金', icon: CreditCard, href: '/admin/billing' },
      { label: 'ユーザー管理', icon: Users, href: '/admin/users' },
      { label: 'スペース', icon: FolderSimple, href: '/admin/spaces' },
      { label: '招待', icon: EnvelopeSimple, href: '/admin/invites' },
    ],
  },
  {
    heading: 'マーケ・コンテンツ',
    items: [
      { label: 'お知らせ', icon: Megaphone, href: '/admin/announcements' },
      { label: 'ブログ', icon: Article, href: '/admin/blog' },
      { label: '分析', icon: ChartLine, href: '/admin/analytics' },
      { label: 'サイトマップ', icon: TreeStructure, href: '/admin/sitemap' },
    ],
  },
  {
    heading: '開発者ツール',
    items: [
      { label: '外部連携', icon: PlugsConnected, href: '/admin/integrations' },
      { label: 'APIキー', icon: Key, href: '/admin/api-keys' },
      { label: 'テーブルブラウザ', icon: Table, href: '/admin/tables' },
      { label: 'CLI利用統計', icon: Terminal, href: '/admin/cli-usage' },
      { label: 'デザインシステム', icon: PaintBrush, href: '/admin/design-system' },
    ],
  },
]

interface AdminSidebarProps {
  /**
   * href → 件数 のバッジ。0/未指定は出さない。
   * 「未処理がある場所」をサイドバーだけで判るようにするためのもので、
   * ポーリングはしない（ページ遷移ごとの再取得で足りる）。
   */
  badges?: Record<string, number>
}

export function AdminSidebar({ badges }: AdminSidebarProps) {
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
            <span className="text-white font-bold text-xs">A</span>
          </div>
          <span className="text-sm font-bold text-gray-900">Admin</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="mb-3 last:mb-0">
            <div className="px-3 pt-1 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
              {group.heading}
            </div>
            {group.items.map((item) => {
              const isActive = pathname.startsWith(item.href)
              const Icon = item.icon
              const count = badges?.[item.href] ?? 0
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
                  {count > 0 && (
                    <span
                      data-testid={`admin-nav-badge-${item.href}`}
                      className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
                    >
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
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
