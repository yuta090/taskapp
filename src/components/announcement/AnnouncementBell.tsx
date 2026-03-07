'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, CheckCircle, Megaphone, Wrench, WarningCircle } from '@phosphor-icons/react'
import { useAnnouncements, type Announcement } from '@/lib/hooks/useAnnouncements'

const CATEGORY_CONFIG: Record<Announcement['category'], { icon: typeof Bell; color: string; label: string }> = {
  info: { icon: Bell, color: 'text-blue-500', label: 'お知らせ' },
  feature: { icon: Megaphone, color: 'text-indigo-500', label: '新機能' },
  maintenance: { icon: Wrench, color: 'text-amber-500', label: 'メンテナンス' },
  important: { icon: WarningCircle, color: 'text-red-500', label: '重要' },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'たった今'
  if (minutes < 60) return `${minutes}分前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}時間前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}日前`
  return `${Math.floor(days / 30)}ヶ月前`
}

type Tab = 'unread' | 'all'

export function AnnouncementBell() {
  const { announcements, unreadCount, markAsRead, markAllAsRead } = useAnnouncements()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('unread')
  const panelRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const toggleOpen = useCallback(() => {
    setOpen((prev) => !prev)
  }, [])

  const displayed = tab === 'unread'
    ? announcements.filter((a) => a.read_at === null)
    : announcements

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        onClick={toggleOpen}
        className="relative p-1.5 rounded-md text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        aria-label="お知らせ"
        title="お知らせ"
      >
        <Bell size={20} weight={unreadCount > 0 ? 'fill' : 'regular'} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-[360px] max-h-[480px] bg-white rounded-lg shadow-lg border border-gray-200 flex flex-col z-50 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">お知らせ</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => markAllAsRead()}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                <CheckCircle size={14} />
                すべて既読
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="flex border-b border-gray-100">
            <button
              onClick={() => setTab('unread')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
                tab === 'unread'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              未読{unreadCount > 0 && ` (${unreadCount})`}
            </button>
            <button
              onClick={() => setTab('all')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
                tab === 'all'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              すべて
            </button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {displayed.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-gray-400">
                <Bell size={32} weight="light" />
                <p className="mt-2 text-sm">
                  {tab === 'unread' ? '未読のお知らせはありません' : 'お知らせはありません'}
                </p>
              </div>
            ) : (
              <ul>
                {displayed.map((item) => {
                  const config = CATEGORY_CONFIG[item.category]
                  const Icon = config.icon
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => {
                          if (item.read_at === null) markAsRead(item.id)
                        }}
                        className={`w-full text-left px-4 py-3 flex gap-3 transition-colors hover:bg-gray-50 ${
                          item.read_at === null ? 'bg-indigo-50/40' : ''
                        }`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 ${config.color}`}>
                          <Icon size={18} weight="duotone" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${config.color} bg-current/10`}>
                              {config.label}
                            </span>
                            {item.read_at === null && (
                              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-sm font-medium text-gray-900 mt-1 truncate">
                            {item.title}
                          </p>
                          {item.body && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                              {item.body}
                            </p>
                          )}
                          <p className="text-[11px] text-gray-400 mt-1">
                            {timeAgo(item.created_at)}
                          </p>
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
