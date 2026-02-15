'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CaretDown,
  List,
  X,
  House,
  ClipboardText,
  ClockCounterClockwise,
  Question,
  SignOut,
} from '@phosphor-icons/react'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface PortalHeaderProps {
  currentProject?: Project
  projects?: Project[]
  onProjectChange?: (project: Project) => void
  userName?: string
}

const navItems = [
  { href: '/portal', label: 'ダッシュボード', icon: House },
  { href: '/portal/tasks', label: '要対応', icon: ClipboardText },
  { href: '/portal/history', label: '履歴', icon: ClockCounterClockwise },
]

export function PortalHeader({
  currentProject,
  projects = [],
  onProjectChange,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userName,
}: PortalHeaderProps) {
  const pathname = usePathname()
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const projectMenuRef = useRef<HTMLDivElement>(null)

  // Close project menu on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(event.target as Node)) {
        setIsProjectMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Close mobile menu on route change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- close menu on navigation
    setIsMobileMenuOpen(false)
  }, [pathname])

  const showProjectSwitcher = projects.length > 1

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Left: Logo + Project Switcher */}
          <div className="flex items-center gap-4">
            {/* Logo */}
            <Link href="/portal" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">TA</span>
              </div>
              <span className="text-lg font-bold text-gray-900 hidden sm:inline">
                TaskApp
              </span>
            </Link>

            {/* Project Switcher */}
            {currentProject && (
              <div className="relative" ref={projectMenuRef}>
                <button
                  onClick={() => showProjectSwitcher && setIsProjectMenuOpen(!isProjectMenuOpen)}
                  className={`
                    flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700
                    rounded-lg transition-colors
                    ${showProjectSwitcher ? 'hover:bg-gray-100 cursor-pointer' : 'cursor-default'}
                  `}
                >
                  <span className="max-w-[150px] truncate">{currentProject.name}</span>
                  {showProjectSwitcher && (
                    <CaretDown
                      className={`w-4 h-4 text-gray-400 transition-transform ${
                        isProjectMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </button>

                {/* Project Dropdown */}
                {isProjectMenuOpen && showProjectSwitcher && (
                  <div className="absolute left-0 mt-1 w-56 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-50">
                    <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                      プロジェクト
                    </div>
                    {projects.map((project) => (
                      <button
                        key={project.id}
                        onClick={() => {
                          onProjectChange?.(project)
                          setIsProjectMenuOpen(false)
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
            )}
          </div>

          {/* Center: Navigation (Desktop) */}
          <nav className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors
                    ${isActive
                      ? 'bg-amber-50 text-amber-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }
                  `}
                >
                  <Icon className="w-4 h-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>

          {/* Right: Help + User Menu */}
          <div className="flex items-center gap-2">
            {/* Help (Desktop) */}
            <button className="hidden md:flex items-center justify-center w-9 h-9 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              <Question className="w-5 h-5" />
            </button>

            {/* Logout (Desktop) */}
            <form action="/api/auth/logout" method="POST" className="hidden md:block">
              <button
                type="submit"
                className="flex items-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <SignOut className="w-4 h-4" />
                <span>ログアウト</span>
              </button>
            </form>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden flex items-center justify-center w-9 h-9 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <List className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden border-t border-gray-200 bg-white">
          <nav className="px-4 py-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors
                    ${isActive
                      ? 'bg-amber-50 text-amber-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }
                  `}
                >
                  <Icon className="w-5 h-5" />
                  {item.label}
                </Link>
              )
            })}
            <hr className="my-2 border-gray-200" />
            <button className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors w-full">
              <Question className="w-5 h-5" />
              ヘルプ
            </button>
            <form action="/api/auth/logout" method="POST">
              <button
                type="submit"
                className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors w-full"
              >
                <SignOut className="w-5 h-5" />
                ログアウト
              </button>
            </form>
          </nav>
        </div>
      )}
    </header>
  )
}
