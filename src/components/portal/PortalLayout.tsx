'use client'

import { ReactNode, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  House,
  Lightning,
  ListChecks,
  Folder,
  NotePencil,
  CheckSquare,
  Gear,
  CaretLeft,
  CaretRight,
  List,
  X,
  SignOut,
  CaretDown,
} from '@phosphor-icons/react'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface PortalLayoutProps {
  children: ReactNode
  currentProject?: Project
  projects?: Project[]
  onProjectChange?: (project: Project) => void
  userName?: string
  actionCount?: number
}

interface NavItem {
  href: string
  label: string
  icon: React.ElementType
  badge?: number
}

export function PortalLayout({
  children,
  currentProject,
  projects = [],
  onProjectChange,
  actionCount = 0,
}: PortalLayoutProps) {
  const pathname = usePathname()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState(false)

  const navItems: NavItem[] = [
    { href: '/portal', label: 'ダッシュボード', icon: House },
    { href: '/portal/tasks', label: '要対応', icon: Lightning, badge: actionCount > 0 ? actionCount : undefined },
    { href: '/portal/all-tasks', label: 'タスク一覧', icon: ListChecks },
    { href: '/portal/files', label: 'ファイル', icon: Folder },
    { href: '/portal/meetings', label: '議事録', icon: NotePencil },
    { href: '/portal/history', label: '承認履歴', icon: CheckSquare },
  ]

  const isActive = (href: string) => {
    if (href === '/portal') {
      return pathname === '/portal'
    }
    return pathname.startsWith(href)
  }

  const showProjectSwitcher = projects.length > 1

  return (
    <div className="min-h-screen bg-[#F0F4F8] flex relative overflow-hidden font-sans selection:bg-indigo-50/30">
      {/* Aurora Background - Refined for freshness and contrast with black text */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute inset-0 bg-slate-50" /> {/* Base lightening layer made opaque */}
        {/* Moved blobs further away/lighter to let black text pop. REPLACED VIOLET AT TOP WITH SKY BLUE */}
        <div className="absolute top-[-30%] left-[-10%] w-[70%] h-[70%] bg-sky-100/40 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute top-[-20%] right-[-20%] w-[60%] h-[60%] bg-blue-50/50 rounded-full blur-[100px] animate-pulse-slow animation-delay-2000"></div>
        <div className="absolute bottom-[-20%] left-[10%] w-[50%] h-[50%] bg-indigo-50/30 rounded-full blur-[100px] animate-pulse-slow animation-delay-4000"></div>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={`
          hidden md:flex flex-col border-r border-white/20
          bg-white/70 backdrop-blur-xl shadow-sm z-10
          ${sidebarCollapsed ? 'w-20' : 'w-64'}
          transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] shrink-0
        `}
      >
        {/* Logo */}
        <div className="h-14 flex items-center px-4 border-b border-gray-100">
          {!sidebarCollapsed ? (
            <Link href="/portal" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">TA</span>
              </div>
              <span className="text-lg font-bold text-gray-900">TaskApp</span>
            </Link>
          ) : (
            <Link href="/portal" className="mx-auto">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">TA</span>
              </div>
            </Link>
          )}
        </div>

        {/* Project Switcher */}
        {currentProject && !sidebarCollapsed && (
          <div className="px-3 py-3 border-b border-gray-100">
            <div className="relative">
              <button
                onClick={() => showProjectSwitcher && setProjectMenuOpen(!projectMenuOpen)}
                className={`
                  w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700
                  rounded-lg transition-colors bg-gray-50
                  ${showProjectSwitcher ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}
                `}
              >
                <span className="flex-1 text-left truncate">{currentProject.name}</span>
                {showProjectSwitcher && (
                  <CaretDown className={`w-4 h-4 text-gray-400 transition-transform ${projectMenuOpen ? 'rotate-180' : ''}`} />
                )}
              </button>
              {projectMenuOpen && showProjectSwitcher && (
                <div className="absolute left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  {projects.map((project) => (
                    <button
                      key={project.id}
                      onClick={() => {
                        onProjectChange?.(project)
                        setProjectMenuOpen(false)
                      }}
                      className={`
                        w-full px-3 py-2 text-sm text-left hover:bg-gray-50 transition-colors
                        ${project.id === currentProject.id ? 'bg-amber-50 text-amber-700' : 'text-gray-700'}
                      `}
                    >
                      {project.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = isActive(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`
                  flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors relative
                  ${active
                    ? 'bg-amber-50 text-amber-700'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }
                  ${sidebarCollapsed ? 'justify-center' : ''}
                `}
                title={sidebarCollapsed ? item.label : undefined}
              >
                <Icon className={`w-5 h-5 shrink-0 ${active ? 'text-amber-600' : ''}`} />
                {!sidebarCollapsed && (
                  <>
                    <span className="text-sm font-medium flex-1">{item.label}</span>
                    {item.badge && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-amber-500 text-white rounded-full">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
                {sidebarCollapsed && item.badge && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full" />
                )}
              </Link>
            )
          })}
        </nav>

        {/* Bottom */}
        <div className="px-3 py-4 border-t border-gray-100 space-y-1">
          <Link
            href="/portal/settings"
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
              ${isActive('/portal/settings')
                ? 'bg-amber-50 text-amber-700'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
              }
              ${sidebarCollapsed ? 'justify-center' : ''}
            `}
            title={sidebarCollapsed ? '設定' : undefined}
          >
            <Gear className="w-5 h-5 shrink-0" />
            {!sidebarCollapsed && <span className="text-sm font-medium">設定</span>}
          </Link>

          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full
                text-gray-600 hover:text-gray-900 hover:bg-gray-100
                ${sidebarCollapsed ? 'justify-center' : ''}
              `}
              title={sidebarCollapsed ? 'ログアウト' : undefined}
            >
              <SignOut className="w-5 h-5 shrink-0" />
              {!sidebarCollapsed && <span className="text-sm font-medium">ログアウト</span>}
            </button>
          </form>

          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className={`
              flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full
              text-gray-400 hover:text-gray-600 hover:bg-gray-100
              ${sidebarCollapsed ? 'justify-center' : ''}
            `}
          >
            {sidebarCollapsed ? (
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

      {/* Mobile Header + Content */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Mobile Header */}
        <header className="md:hidden sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200/50">
          <div className="flex items-center justify-between h-14 px-4">
            <Link href="/portal" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-sm">TA</span>
              </div>
              <span className="text-lg font-bold text-gray-900 tracking-tight">TaskApp</span>
            </Link>
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 rounded-lg"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <List className="w-6 h-6" />}
            </button>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="border-t border-gray-200 bg-white/95 backdrop-blur-xl">
              {currentProject && (
                <div className="px-4 py-3 border-b border-gray-100">
                  <div className="text-xs text-gray-500 mb-1">プロジェクト</div>
                  <div className="text-sm font-medium text-gray-900">{currentProject.name}</div>
                </div>
              )}
              <nav className="px-2 py-3 space-y-1">
                {navItems.map((item) => {
                  const Icon = item.icon
                  const active = isActive(item.href)
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`
                        flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
                        ${active
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                        }
                      `}
                    >
                      <Icon className="w-5 h-5" />
                      <span className="text-sm font-medium flex-1">{item.label}</span>
                      {item.badge && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-indigo-500 text-white rounded-full shadow-sm">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
                <hr className="my-2 border-gray-200" />
                <Link
                  href="/portal/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-50"
                >
                  <Gear className="w-5 h-5" />
                  <span className="text-sm font-medium">設定</span>
                </Link>
                <form action="/api/auth/logout" method="POST">
                  <button
                    type="submit"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-50 w-full"
                  >
                    <SignOut className="w-5 h-5" />
                    <span className="text-sm font-medium">ログアウト</span>
                  </button>
                </form>
              </nav>
            </div>
          )}
        </header>

        {/* Main Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
