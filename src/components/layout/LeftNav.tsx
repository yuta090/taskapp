'use client'

import { useState, useEffect, useCallback, useContext } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Tray,
  Target,
  PencilSimpleLine,
  CaretDown,
  CaretLeft,
  CaretRight,
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
  Check,
} from '@phosphor-icons/react'
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { createClient } from '@/lib/supabase/client'
import { SpaceCreateSheet } from '@/components/space/SpaceCreateSheet'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

const STORAGE_KEY = 'taskapp:sidebar:internal:collapsed'

interface NavItemProps {
  href: string
  icon: React.ReactNode
  label: string
  badge?: number
  active?: boolean
  collapsed?: boolean
}

function NavItem({ href, icon, label, badge, active, collapsed }: NavItemProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`px-2 py-2 rounded cursor-pointer flex items-center group transition-colors relative ${
        collapsed ? 'justify-center' : 'gap-2.5'
      } ${
        active
          ? 'text-gray-900 bg-gray-200/60 font-medium'
          : 'text-gray-600 hover:bg-gray-200/50'
      }`}
      title={collapsed ? label : undefined}
    >
      <span className="text-xl 2xl:text-2xl text-gray-500 group-hover:text-gray-900 flex-shrink-0">
        {icon}
      </span>
      {!collapsed && (
        <span className="truncate text-sm 2xl:text-base">{label}</span>
      )}
      {!collapsed && badge !== undefined && badge > 0 && (
        <span className="ml-auto text-[10px] 2xl:text-xs px-1.5 py-0.5 rounded bg-gray-900 text-white">
          {badge}
        </span>
      )}
      {collapsed && badge !== undefined && badge > 0 && (
        <span className="absolute top-0.5 right-1 w-2 h-2 bg-gray-900 rounded-full" />
      )}
    </Link>
  )
}

interface SubNavItemProps {
  href: string
  icon: React.ReactNode
  label: string
  active?: boolean
  collapsed?: boolean
}

function SubNavItem({ href, icon, label, active, collapsed }: SubNavItemProps) {
  return (
    <Link
      href={href}
      prefetch={false}
      className={`px-2 py-1.5 rounded cursor-pointer flex items-center transition-colors ${
        collapsed ? 'justify-center' : 'gap-2 text-xs 2xl:text-sm'
      } ${
        active
          ? 'text-gray-900 bg-gray-200/60'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
      }`}
      title={collapsed ? label : undefined}
    >
      <span className={collapsed ? 'text-lg 2xl:text-xl' : 'text-base 2xl:text-lg'}>{icon}</span>
      {!collapsed && <span>{label}</span>}
    </Link>
  )
}

function UserMenu({ collapsed }: { collapsed?: boolean }) {
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
      <div className={`${collapsed ? 'px-1.5' : 'px-3'} py-3 pb-4 border-t border-gray-200`}>
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'} px-2 py-2`}>
          <div className="w-7 h-7 rounded-full bg-gray-200 animate-pulse flex-shrink-0" />
          {!collapsed && (
            <div className="flex-1">
              <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className={`${collapsed ? 'px-1.5' : 'px-3'} py-3 pb-4 border-t border-gray-200`}>
        <Link
          href="/login"
          className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'} px-2 py-2 rounded hover:bg-gray-200/60 text-gray-600 transition-colors`}
          title={collapsed ? 'ログイン' : undefined}
        >
          <User className="text-lg flex-shrink-0" />
          {!collapsed && <span className="text-sm">ログイン</span>}
        </Link>
      </div>
    )
  }

  const userName = user.user_metadata?.name || user.email?.split('@')[0] || 'ユーザー'
  const userInitial = userName.charAt(0).toUpperCase()

  return (
    <div className={`${collapsed ? 'px-1.5' : 'px-3'} py-3 pb-4 border-t border-gray-200 relative`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-2'} px-2 py-2 rounded hover:bg-gray-200/60 transition-colors group`}
        title={collapsed ? userName : undefined}
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-medium shadow-sm flex-shrink-0">
          {userInitial}
        </div>
        {!collapsed && (
          <>
            <div className="flex-1 text-left min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{userName}</div>
              <div className="text-[10px] text-gray-500 truncate">{user.email}</div>
            </div>
            <CaretUp
              className={`text-gray-400 text-xs transition-transform ${isOpen ? '' : 'rotate-180'}`}
              weight="bold"
            />
          </>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className={`absolute bottom-full mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 ${
            collapsed ? 'left-0 w-48' : 'left-3 right-3'
          }`}>
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
  const [collapsed, setCollapsed] = useState(false)
  const { activeOrgId, activeOrgName, orgs, switchOrg } = useContext(ActiveOrgContext)
  const [isOrgSwitcherOpen, setIsOrgSwitcherOpen] = useState(false)

  const fallbackSpaceId = '00000000-0000-0000-0000-000000000010'
  const match = pathname.match(new RegExp('^/([^/]+)/project/([^/?]+)'))
  const orgId = match?.[1] ?? activeOrgId ?? ''
  const spaceId = match?.[2] ?? fallbackSpaceId
  const hasProjectRoute = !!match
  const { pendingCount: inboxCount } = useUnreadNotificationCount()
  const [isSpaceCreateOpen, setIsSpaceCreateOpen] = useState(false)

  // 組織名のイニシャル（最初の2文字）
  const orgInitial = activeOrgName
    ? activeOrgName.length <= 2
      ? activeOrgName
      : activeOrgName.slice(0, 2)
    : '--'
  const orgDisplayName = activeOrgName ?? '組織未設定'

  const projectBasePath = `/${orgId}/project/${spaceId}`

  // Restore collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with external storage (localStorage)
    if (saved === 'true') setCollapsed(true)
  }, [])

  // Keyboard shortcut: Cmd/Ctrl + \
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault()
        setCollapsed(prev => {
          const next = !prev
          localStorage.setItem(STORAGE_KEY, String(next))
          return next
        })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, String(next))
      return next
    })
  }, [])

  const handleQuickCreate = useCallback(() => {
    if (hasProjectRoute) {
      router.push(`${projectBasePath}?create=1`)
    } else {
      // Outside project context: open global create on My Tasks page
      router.push('/my?create=1')
    }
  }, [hasProjectRoute, projectBasePath, router])

  // Global keyboard shortcut: C to open task creation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip during IME composition or key repeat
      if (e.isComposing || e.repeat) return
      // Skip when typing in input fields, textareas, selects, or contentEditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return
      // Skip when modifier keys are held (allow Cmd+C, Ctrl+C, etc.)
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        handleQuickCreate()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleQuickCreate])

  const handleSpaceCreated = (newSpaceId: string) => {
    router.push(`/${orgId}/project/${newSpaceId}`)
  }

  return (
    <aside
      className={`${
        collapsed ? 'w-16' : 'w-[240px] 2xl:w-[280px]'
      } bg-[#F7F8F9] border-r border-gray-200 flex flex-col flex-shrink-0 select-none z-20 transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)]`}
    >
      {/* Workspace + Quick Create */}
      <div className={`h-12 flex items-center ${collapsed ? 'px-2 justify-center' : 'px-3'} gap-2 mt-1 relative`}>
        <button
          type="button"
          onClick={() => setIsOrgSwitcherOpen(!isOrgSwitcherOpen)}
          data-testid="leftnav-workspace"
          className={`flex items-center gap-2 ${collapsed ? 'p-1.5' : 'px-2 py-1.5'} rounded hover:bg-gray-200/60 cursor-pointer transition-colors group relative`}
          title={collapsed ? orgDisplayName : undefined}
        >
          <div className="w-5 h-5 2xl:w-6 2xl:h-6 bg-orange-600 rounded flex items-center justify-center text-white text-[10px] 2xl:text-xs font-bold shadow-sm flex-shrink-0">
            {orgInitial}
          </div>
          {!collapsed && (
            <>
              <span className="font-medium text-gray-900 truncate text-sm 2xl:text-base max-w-[130px]">
                {orgDisplayName}
              </span>
              <CaretDown
                weight="bold"
                className={`text-gray-400 text-[10px] 2xl:text-xs group-hover:text-gray-600 transition-transform ${isOrgSwitcherOpen ? 'rotate-180' : ''}`}
              />
            </>
          )}
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={handleQuickCreate}
            data-testid="leftnav-quick-create"
            className="p-1.5 2xl:p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-200/60 rounded transition-colors"
            title="新規作成 (C)"
          >
            <PencilSimpleLine className="text-xl 2xl:text-2xl" weight="bold" />
          </button>
        )}

        {/* Org Menu Dropdown */}
        {isOrgSwitcherOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOrgSwitcherOpen(false)}
            />
            <div className={`absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-50 ${
              collapsed ? 'left-0 w-56' : 'left-3 right-3'
            }`}>
              {/* Org switcher (multi-org only) */}
              {orgs.length > 1 && (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                    組織を切替
                  </div>
                  {orgs.map(org => (
                    <button
                      key={org.orgId}
                      type="button"
                      onClick={() => {
                        switchOrg(org.orgId)
                        setIsOrgSwitcherOpen(false)
                        router.push('/inbox')
                      }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors ${
                        org.orgId === activeOrgId
                          ? 'text-gray-900 bg-gray-50'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-5 h-5 bg-orange-600 rounded flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0">
                        {org.orgName.length <= 2 ? org.orgName : org.orgName.slice(0, 2)}
                      </div>
                      <span className="truncate flex-1 text-left">{org.orgName}</span>
                      {org.orgId === activeOrgId && (
                        <Check className="text-gray-900 text-sm flex-shrink-0" weight="bold" />
                      )}
                    </button>
                  ))}
                  <hr className="my-1 border-gray-100" />
                </>
              )}
              {/* Org settings links */}
              <Link
                href="/settings/organization"
                onClick={() => setIsOrgSwitcherOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Gear className="text-base text-gray-500" />
                組織設定
              </Link>
              <Link
                href="/settings/members"
                onClick={() => setIsOrgSwitcherOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <User className="text-base text-gray-500" />
                メンバー管理
              </Link>
              <Link
                href="/settings/billing"
                onClick={() => setIsOrgSwitcherOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Key className="text-base text-gray-500" />
                プランと請求
              </Link>
            </div>
          </>
        )}
      </div>

      {/* Nav Items */}
      <div className={`flex-1 overflow-y-auto ${collapsed ? 'px-1.5' : 'px-2'} space-y-6 pt-2 hide-scrollbar`}>
        {/* Personal */}
        <div className="space-y-0.5">
          <NavItem
            href="/inbox"
            icon={<Tray />}
            label="受信トレイ"
            badge={inboxCount}
            active={pathname === '/inbox'}
            collapsed={collapsed}
          />
          <NavItem
            href="/my"
            icon={<Target />}
            label="マイタスク"
            active={pathname === '/my'}
            collapsed={collapsed}
          />
        </div>

        {/* Team / Project */}
        <div>
          {!collapsed && (
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
          )}

          <div className="space-y-0.5">
            {/* Project root */}
            <Link
              href={projectBasePath}
              prefetch={false}
              className={`px-2 py-2 text-gray-600 hover:bg-gray-200/50 rounded cursor-pointer flex items-center ${
                collapsed ? 'justify-center' : 'gap-2.5'
              } group`}
              title={collapsed ? 'Webリニューアル' : undefined}
            >
              <div className="w-5 h-5 2xl:w-6 2xl:h-6 rounded bg-indigo-600 text-white flex items-center justify-center text-xs 2xl:text-sm shadow-sm flex-shrink-0">
                <Planet weight="fill" />
              </div>
              {!collapsed && (
                <>
                  <span className="truncate text-sm 2xl:text-base">Webリニューアル</span>
                  <CaretDown
                    weight="fill"
                    className="text-[10px] 2xl:text-xs ml-auto text-gray-400"
                  />
                </>
              )}
            </Link>

            {/* Project sub-nav */}
            <div className={collapsed ? 'space-y-0.5' : 'pl-2 mt-0.5 space-y-0.5 border-l border-gray-200 ml-4'}>
              <SubNavItem
                href={projectBasePath}
                icon={<Copy />}
                label="タスク"
                active={pathname === projectBasePath}
                collapsed={collapsed}
              />
              <SubNavItem
                href={`${projectBasePath}?filter=client_wait`}
                icon={<ChatCircleText />}
                label="確認待ち"
                collapsed={collapsed}
              />
              <SubNavItem
                href={`${projectBasePath}/meetings`}
                icon={<Notebook />}
                label="議事録"
                active={pathname.includes('/meetings')}
                collapsed={collapsed}
              />
              <SubNavItem
                href={`${projectBasePath}/wiki`}
                icon={<BookOpen />}
                label="Wiki"
                active={pathname.includes('/wiki')}
                collapsed={collapsed}
              />
              <SubNavItem
                href={`${projectBasePath}/views/gantt`}
                icon={<SquaresFour />}
                label="ガントチャート"
                active={pathname.includes('/views')}
                collapsed={collapsed}
              />
              <SubNavItem
                href={`${projectBasePath}/settings`}
                icon={<Gear />}
                label="設定"
                active={pathname.includes('/settings')}
                collapsed={collapsed}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Collapse toggle - fixed above user menu */}
      <div className={`${collapsed ? 'px-1.5' : 'px-3'} py-1`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`flex items-center ${
            collapsed ? 'justify-center w-full' : 'gap-2'
          } px-2 py-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200/60 transition-colors w-full`}
          title={collapsed ? 'サイドバーを展開 (⌘\\)' : undefined}
        >
          {collapsed ? (
            <CaretRight className="text-lg" weight="bold" />
          ) : (
            <>
              <CaretLeft className="text-lg" weight="bold" />
              <span className="text-xs text-gray-400">折りたたむ</span>
            </>
          )}
        </button>
      </div>

      {/* User Menu at bottom */}
      <UserMenu collapsed={collapsed} />

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
