'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore } from 'react'
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
  EnvelopeOpen,
  CheckCircle,
  ChartLine,
  TreeStructure,
  PaintBrush,
  PlugsConnected,
  Terminal,
  Article,
  ChatCircle,
  Receipt,
  SignOut,
  CaretDoubleLeft,
  CaretDoubleRight,
} from '@phosphor-icons/react'
import { signOutAndLeave } from '@/lib/auth/signOutClient'
import { AgentPmMark } from '@/components/brand/AgentPmMark'

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
 * 動的な「今やること」セクションは意図的に入れない（利用者2名の運用では維持されず腐るため。
 * キューの可視化は件数バッジで足りる）。ナビ項目の折りたたみもしない。
 * ※ サイドバー全体をアイコン幅に畳む機能（2026-09-07）は別物で、横幅が要る画面のためのもの。
 */
const NAV_GROUPS: {
  heading: string
  items: { label: string; icon: typeof ChartBar; href: string }[]
}[] = [
  {
    heading: '運用',
    items: [
      { label: '共通LINE開通', icon: ChatCircle, href: '/admin/shared-bot-access' },
      { label: '枠追加の見積もり', icon: Receipt, href: '/admin/quotes' },
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
      { label: 'メール文面', icon: EnvelopeOpen, href: '/admin/email-templates' },
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
  /** サーバー（layout）が cookie から読んだ初期値。初回描画から畳んだ状態で出すため */
  initialCollapsed?: boolean
}

/** 畳んだ状態を覚えるキー（端末ごと・運営本人の好み。サーバーには持たない） */
export const COLLAPSED_STORAGE_KEY = 'admin-sidebar-collapsed'
const COLLAPSED_EVENT = 'admin-sidebar-collapsed-change'

function readCollapsed(): boolean {
  // localStorage が正。無ければ cookie（サーバーが初回描画に使ったのと同じ値）に合わせる
  try {
    const v = window.localStorage.getItem(COLLAPSED_STORAGE_KEY)
    if (v === '1' || v === '0') return v === '1'
  } catch {
    /* fall through */
  }
  try {
    return new RegExp(`(?:^|; )${COLLAPSED_STORAGE_KEY}=1(?:;|$)`).test(document.cookie)
  } catch {
    return false
  }
}

function writeCollapsed(v: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, v ? '1' : '0')
  } catch {
    /* 保存できなくても動作には影響しない */
  }
  // サーバー側（layout）が初回描画から畳んだ状態で出せるよう cookie にも書く（初回表示のガタつき防止）
  try {
    document.cookie = `${COLLAPSED_STORAGE_KEY}=${v ? '1' : '0'}; path=/admin; max-age=31536000; SameSite=Lax`
  } catch {
    /* noop */
  }
  window.dispatchEvent(new Event(COLLAPSED_EVENT))
}

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener(COLLAPSED_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(COLLAPSED_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

/**
 * 折りたたみ状態。localStorage を「外部ストア」として購読する。SSR は layout が cookie から読んだ
 * initialCollapsed で描くので、畳んでいる人も初回描画からアイコン幅で出る（ガタつかない）。
 * メール文面のプレビューなど横幅が要る画面で、アイコンだけに畳んで作業領域を広げるためのもの。
 */
function useSidebarCollapsed(initialCollapsed: boolean): [boolean, () => void] {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => initialCollapsed)
  const toggle = () => writeCollapsed(!readCollapsed())
  return [collapsed, toggle]
}

export function AdminSidebar({ badges, initialCollapsed = false }: AdminSidebarProps) {
  const pathname = usePathname()
  const [collapsed, toggleCollapsed] = useSidebarCollapsed(initialCollapsed)

  async function handleLogout() {
    await signOutAndLeave({ to: '/admin/login', pushCleanup: false })
  }

  return (
    <aside
      data-testid="admin-sidebar"
      data-collapsed={collapsed ? 'true' : 'false'}
      className={`${collapsed ? 'w-14' : 'w-60'} h-screen bg-surface border-r border-gray-200 flex flex-col shrink-0 transition-[width] duration-150`}
    >
      {/* Header */}
      <div className={`${collapsed ? 'px-2' : 'px-4'} py-4 border-b border-gray-200`}>
        <div className={`flex items-center ${collapsed ? 'flex-col gap-2' : 'gap-2'}`}>
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0">
            <AgentPmMark size={21} className="text-white" />
          </div>
          {!collapsed && <span className="text-sm font-bold text-gray-900 flex-1">Admin</span>}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'メニューを広げる' : 'メニューを畳む'}
            title={collapsed ? 'メニューを広げる' : 'メニューを畳む'}
            className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {collapsed ? <CaretDoubleRight size={16} /> : <CaretDoubleLeft size={16} />}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.heading} className="mb-3 last:mb-0">
            {collapsed ? (
              <div className="mx-2 my-1 border-t border-gray-100 first:hidden" aria-hidden="true" />
            ) : (
              <div className="px-3 pt-1 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                {group.heading}
              </div>
            )}
            {group.items.map((item) => {
              const isActive = pathname.startsWith(item.href)
              const Icon = item.icon
              const count = badges?.[item.href] ?? 0
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={item.label}
                  aria-label={collapsed ? item.label : undefined}
                  className={`relative flex items-center gap-2.5 ${collapsed ? 'justify-center px-0' : 'px-3'} py-1.5 rounded-lg text-sm transition-colors mb-0.5 ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-ink font-medium'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <Icon size={18} weight={isActive ? 'fill' : 'regular'} />
                  {!collapsed && item.label}
                  {count > 0 && (
                    <span
                      data-testid={`admin-nav-badge-${item.href}`}
                      className={`${
                        collapsed ? 'absolute -top-0.5 -right-0.5' : 'ml-auto'
                      } bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1`}
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
          title="ログアウト"
          aria-label="ログアウト"
          className={`flex items-center gap-2.5 ${collapsed ? 'justify-center px-0' : 'px-3'} py-1.5 rounded-lg text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-900 w-full transition-colors`}
        >
          <SignOut size={18} />
          {!collapsed && 'ログアウト'}
        </button>
      </div>
    </aside>
  )
}
