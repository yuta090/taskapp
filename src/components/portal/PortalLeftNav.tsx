'use client'

import { useState, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  House,
  Lightning,
  ListChecks,
  Folder,
  NotePencil,
  BookOpen,
  CheckSquare,
  Gear,
  CaretDown,
  CaretUp,
  SignOut,
  User,
  Planet,
} from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'

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
      className={`px-2 py-2 rounded-lg cursor-pointer flex items-center gap-2.5 group transition-all duration-200 ${active
          ? 'text-indigo-900 bg-indigo-50/80 font-medium ring-1 ring-indigo-200'
          : 'text-gray-600 hover:bg-white/50 hover:text-gray-900'
        }`}
    >
      <span className={`text-xl 2xl:text-2xl ${active ? 'text-indigo-600' : 'text-gray-500'} group-hover:text-gray-900`}>
        {icon}
      </span>
      <span className="truncate text-sm 2xl:text-base">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto text-[10px] 2xl:text-xs px-1.5 py-0.5 rounded bg-amber-500 text-white shadow-sm">
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
  badge?: number
  active?: boolean
}

function SubNavItem({ href, icon, label, badge, active }: SubNavItemProps) {
  return (
    <Link
      href={href}
      className={`px-2 py-1.5 rounded-lg cursor-pointer flex items-center gap-2 text-xs 2xl:text-sm transition-all duration-200 ${active
          ? 'text-indigo-900 bg-indigo-50/60 font-medium ring-1 ring-indigo-100'
          : 'text-gray-500 hover:text-gray-900 hover:bg-white/50'
        }`}
    >
      <span className={`text-base 2xl:text-lg ${active ? 'text-indigo-600' : ''}`}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500 text-white shadow-sm">
          {badge}
        </span>
      )}
    </Link>
  )
}

interface UserMenuProps {
  userName?: string
  userEmail?: string
}

function UserMenu({ userName, userEmail }: UserMenuProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  const handleLogout = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }, [router])

  const displayName = userName || userEmail?.split('@')[0] || 'ゲスト'
  const userInitial = displayName.charAt(0).toUpperCase()

  return (
    <div className="px-3 py-3 pb-4 border-t border-white/40 relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-white/50 transition-colors group"
      >
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white flex items-center justify-center text-xs font-medium shadow-md">
          {userInitial}
        </div>
        <div className="flex-1 text-left min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{displayName}</div>
          {userEmail && (
            <div className="text-[10px] text-gray-500 truncate">{userEmail}</div>
          )}
        </div>
        <CaretUp
          className={`text-gray-400 text-xs transition-transform ${isOpen ? '' : 'rotate-180'}`}
          weight="bold"
        />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-full left-3 right-3 mb-1 bg-white/90 backdrop-blur-xl border border-white/60 rounded-lg shadow-xl py-1 z-50">
            <Link
              href="/portal/settings"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User className="text-base text-gray-500" />
              プロフィール設定
            </Link>
            <Link
              href="/docs/manual/client"
              onClick={() => setIsOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <BookOpen className="text-base text-gray-500" />
              ご利用ガイド
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

interface PortalLeftNavProps {
  currentProject?: {
    id: string
    name: string
    orgId: string
    orgName?: string
  }
  projects?: {
    id: string
    name: string
    orgId: string
    orgName?: string
  }[]
  actionCount?: number
}

export function PortalLeftNav({
  currentProject,
  projects = [],
  actionCount = 0,
}: PortalLeftNavProps) {
  const pathname = usePathname()
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)

  const showProjectSwitcher = projects.length > 1

  return (
    <aside className="w-[240px] 2xl:w-[280px] bg-white/60 backdrop-blur-xl border-r border-white/40 flex flex-col flex-shrink-0 select-none z-20 shadow-sm transition-colors duration-300">
      {/* Logo + Project Switcher */}
      <div className="h-12 flex items-center px-3 gap-2 mt-1 relative">
        <button
          type="button"
          onClick={() => showProjectSwitcher && setProjectMenuOpen(!projectMenuOpen)}
          className={`flex items-center gap-2 px-2 py-1.5 rounded flex-1 transition-colors group ${showProjectSwitcher ? 'hover:bg-white/50 cursor-pointer' : 'cursor-default'
            }`}
        >
          <div className="w-5 h-5 2xl:w-6 2xl:h-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded flex items-center justify-center text-white text-[10px] 2xl:text-xs font-bold shadow-md">
            TA
          </div>
          <span className="font-medium text-gray-900 truncate text-sm 2xl:text-base">
            {currentProject?.name || 'TaskApp'}
          </span>
          {showProjectSwitcher && (
            <CaretDown
              weight="bold"
              className={`text-gray-400 text-[10px] 2xl:text-xs group-hover:text-gray-600 transition-transform ${projectMenuOpen ? 'rotate-180' : ''
                }`}
            />
          )}
        </button>

        {/* Project Dropdown */}
        {projectMenuOpen && showProjectSwitcher && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(false)} />
            <div className="absolute top-full left-3 right-3 mt-1 bg-white/90 backdrop-blur-xl border border-white/50 rounded-lg shadow-xl py-1 z-50">
              <div className="px-3 py-2 text-[10px] font-medium text-gray-500 uppercase tracking-wide">
                プロジェクト
              </div>
              {projects.map((project) => (
                <Link
                  key={project.id}
                  href="/portal"
                  onClick={() => setProjectMenuOpen(false)}
                  className={`flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${project.id === currentProject?.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                    }`}
                >
                  <Planet className="text-base" weight="fill" />
                  {project.name}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Nav Items */}
      <div className="flex-1 overflow-y-auto px-2 space-y-6 pt-2 hide-scrollbar">
        {/* Dashboard */}
        <div className="space-y-0.5">
          <NavItem
            href="/portal"
            icon={<House />}
            label="ダッシュボード"
            active={pathname === '/portal'}
          />
        </div>

        {/* Project Menu */}
        <div>
          <div className="px-2 text-[10px] 2xl:text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide opacity-70">
            プロジェクト
          </div>

          <div className="space-y-0.5">
            {/* Project sub-nav */}
            <div className="space-y-0.5">
              <SubNavItem
                href="/portal/tasks"
                icon={<Lightning />}
                label="要対応"
                badge={actionCount}
                active={pathname === '/portal/tasks'}
              />
              <SubNavItem
                href="/portal/all-tasks"
                icon={<ListChecks />}
                label="タスク一覧"
                active={pathname === '/portal/all-tasks'}
              />
              <SubNavItem
                href="/portal/files"
                icon={<Folder />}
                label="ファイル"
                active={pathname === '/portal/files'}
              />
              <SubNavItem
                href="/portal/meetings"
                icon={<NotePencil />}
                label="議事録"
                active={pathname === '/portal/meetings'}
              />
              <SubNavItem
                href="/portal/wiki"
                icon={<BookOpen />}
                label="Wiki"
                active={pathname === '/portal/wiki'}
              />
              <SubNavItem
                href="/portal/history"
                icon={<CheckSquare />}
                label="承認履歴"
                active={pathname === '/portal/history'}
              />
              <SubNavItem
                href="/portal/settings"
                icon={<Gear />}
                label="設定"
                active={pathname === '/portal/settings'}
              />
            </div>
          </div>
        </div>
      </div>

      {/* User Menu at bottom */}
      <UserMenu />
    </aside>
  )
}
