'use client'

import { useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Tray,
  Target,
  PencilSimpleLine,
  CaretDown,
  Planet,
  Copy,
  ChatCircleText,
  Notebook,
  BookOpen,
  SquaresFour,
  Gear,
  SignOut,
  User,
  GearSix,
  CaretUp,
  Key,
  Plus,
} from '@phosphor-icons/react'
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { createClient } from '@/lib/supabase/client'
import { SpaceCreateSheet } from '@/components/space/SpaceCreateSheet'

interface NavItemProps {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number
  active?: boolean
}

function NavItem({ href, icon, label, badge, active }: NavItemProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`px-2 py-2 rounded cursor-pointer flex items-center gap-2.5 group transition-colors ${
        active
          ? 'text-gray-900 bg-gray-200/60 font-medium'
          : 'text-gray-600 hover:bg-gray-200/50'
      }`}
    >
      <span className="text-xl 2xl:text-2xl text-gray-500 group-hover:text-gray-900">
        {icon}
      </span>
      <span className="truncate text-sm 2xl:text-base">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto text-[10px] 2xl:text-xs px-1.5 py-0.5 rounded bg-gray-900 text-white">
          {badge}
        </span>
      )}
    </Link>
  )
}

interface SubNavItemProps {
  href: string
  icon: React.ReactNode
  label: string
  active?: boolean
}

function SubNavItem({ href, icon, label, active }: SubNavItemProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`px-2 py-1.5 rounded cursor-pointer flex items-center gap-2 text-xs 2xl:text-sm ${
        active
          ? 'text-gray-900 bg-gray-200/60'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
      }`}
    >
      <span className="text-base 2xl:text-lg">{icon}</span>
      <span>{label}</span>
    </Link>
  )
}

function UserMenu() {
  const { user, loading } = useCurrentUser()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  const handleLogout = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }, [router])

  if (loading) {
    return (
      <div className="px-3 py-3 pb-4 border-t border-gray-200">
        <div className="flex items-center gap-2 px-2 py-2">
          <div className="w-7 h-7 rounded-full bg-gray-200 animate-pulse" />
          <div className="flex-1">
            <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="px-3 py-3 pb-4 border-t border-gray-200">
        <Link
          href="/login"
          className="flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-200/60 text-gray-600 transition-colors"
        >
          <User className="text-lg" />
          <span className="text-sm">ログイン</span>
        </Link>
      </div>
    )
  }

  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'ユーザー'
  const userInitial = userName.charAt(0).toUpperCase()

  return (
    <div className="px-3 py-3 pb-4 border-t border-gray-200 relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-gray-200/60 transition-colors group"
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-medium shadow-sm">
          {userInitial}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
          <div className="text-[10px] text-gray-500 truncate">{user.email}</div>
        </div>
        <CaretUp
          className={`text-gray-400 text-xs transition-transform ${isOpen ? '' : 'rotate-180'}`}
          weight="bold"
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50">
            <Link
              href="/settings/account"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <GearSix className="text-base text-gray-500" />
              アカウント設定
            </Link>
            <Link
              href="/settings/api-keys"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Key className="text-base text-gray-500" />
              APIキー管理
            </Link>
            <Link
              href="/docs/manual/internal"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <BookOpen className="text-base text-gray-500" />
              マニュアル
            </Link>
            <hr className="my-1 border-gray-100" />
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <SignOut className="text-base" />
              ログアウト
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function LeftNav() {
  const pathname = usePathname()
  const router = useRouter()

  const fallbackOrgId = '00000000-0000-0000-0000-000000000001'
  const fallbackSpaceId = '00000000-0000-0000-0000-000000000010'
  const match = pathname.match(new RegExp('^/([^/]+)/project/([^/?]+)'))
  const orgId = match?.[1] ?? fallbackOrgId
  const spaceId = match?.[2] ?? fallbackSpaceId
  const hasProjectRoute = !!match // true when orgId comes from URL, not fallback
  const { count: inboxCount } = useUnreadNotificationCount()
  const [isSpaceCreateOpen, setIsSpaceCreateOpen] = useState(false)

  const projectBasePath = `/${orgId}/project/${spaceId}`
  const handleQuickCreate = () => {
    router.push(`${projectBasePath}?create=1`)
  }

  const handleWorkspaceClick = () => {
    router.push(projectBasePath)
  }

  const handleSpaceCreated = (newSpaceId: string) => {
    router.push(`/${orgId}/project/${newSpaceId}`)
  }

  return (
    <aside className="w-[240px] 2xl:w-[280px] bg-[#F7F8F9] border-r border-gray-200 flex flex-col flex-shrink-0 select-none z-20">
      {/* Workspace + Quick Create */}
      <div className="h-12 flex items-center px-3 gap-2 mt-1">
        <button
          type="button"
          onClick={handleWorkspaceClick}
          data-testid="leftnav-workspace"
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-200/60 cursor-pointer flex-1 transition-colors group relative"
        >
          <div className="w-5 h-5 2xl:w-6 2xl:h-6 bg-orange-600 rounded flex items-center justify-center text-white text-[10px] 2xl:text-xs font-bold shadow-sm">
            TA
          </div>
          <span className="font-medium text-gray-900 truncate text-sm 2xl:text-base">
            株式会社アトラス
          </span>
          <CaretDown
            weight="bold"
            className="text-gray-400 text-[10px] 2xl:text-xs group-hover:text-gray-600"
          />
        </button>
        <button
          type="button"
          onClick={handleQuickCreate}
          data-testid="leftnav-quick-create"
          className="p-1.5 2xl:p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200/60 rounded transition-colors"
          title="新規作成 (C)"
        >
          <PencilSimpleLine className="text-xl 2xl:text-2xl" weight="bold" />
        </button>
      </div>

      {/* Nav Items */}
      <div className="flex-1 overflow-y-auto px-2 space-y-6 pt-2 hide-scrollbar">
        {/* Personal */}
        <div className="space-y-0.5">
          <NavItem
            href="/inbox"
            icon={<Tray />}
            label="受信トレイ"
            badge={inboxCount}
            active={pathname === '/inbox'}
          />
          <NavItem
            href="/my"
            icon={<Target />}
            label="自分の課題"
            active={pathname === '/my'}
          />
        </div>

        {/* Team / Project */}
        <div>
          <div className="px-2 text-[10px] 2xl:text-xs font-medium text-gray-500 mb-1.5 flex items-center justify-between">
            <span>チーム</span>
            {hasProjectRoute && (
              <button
                type="button"
                onClick={() => setIsSpaceCreateOpen(true)}
                className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors"
                title="新しいプロジェクト"
              >
                <Plus className="text-sm" weight="bold" />
              </button>
            )}
          </div>

          <div className="space-y-0.5">
            {/* Project root */}
            <Link
              href={projectBasePath}
              prefetch={false}
              className="px-2 py-2 text-gray-600 hover:bg-gray-200/50 rounded cursor-pointer flex items-center gap-2.5 group"
            >
              <div className="w-5 h-5 2xl:w-6 2xl:h-6 rounded bg-indigo-600 text-white flex items-center justify-center text-xs 2xl:text-sm shadow-sm">
                <Planet weight="fill" />
              </div>
              <span className="truncate text-sm 2xl:text-base">Webリニューアル</span>
              <CaretDown
                weight="fill"
                className="text-[10px] 2xl:text-xs ml-auto text-gray-400"
              />
            </Link>

            {/* Project sub-nav */}
            <div className="pl-2 mt-0.5 space-y-0.5 border-l border-gray-200 ml-4">
              <SubNavItem
                href={projectBasePath}
                icon={<Copy />}
                label="課題"
                active={pathname === projectBasePath}
              />
              <SubNavItem
                href={`${projectBasePath}?filter=client_wait`}
                icon={<ChatCircleText />}
                label="確認待ち"
              />
              <SubNavItem
                href={`${projectBasePath}/meetings`}
                icon={<Notebook />}
                label="議事録"
                active={pathname.includes('/meetings')}
              />
              <SubNavItem
                href={`${projectBasePath}/wiki`}
                icon={<BookOpen />}
                label="Wiki"
                active={pathname.includes('/wiki')}
              />
              <SubNavItem
                href={`${projectBasePath}/views/gantt`}
                icon={<SquaresFour />}
                label="ガントチャート"
                active={pathname.includes('/views')}
              />
              <SubNavItem
                href={`${projectBasePath}/settings`}
                icon={<Gear />}
                label="設定"
                active={pathname.includes('/settings')}
              />
            </div>
          </div>
        </div>
      </div>

      {/* User Menu at bottom */}
      <UserMenu />

      {/* Space Create Sheet */}
      <SpaceCreateSheet
        isOpen={isSpaceCreateOpen}
        onClose={() => setIsSpaceCreateOpen(false)}
        orgId={orgId}
        onCreated={handleSpaceCreated}
      />
    </aside>
  )
}
