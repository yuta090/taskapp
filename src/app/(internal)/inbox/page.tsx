'use client'

import { Suspense, useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Tray,
  CheckCircle,
  Bell,
  ChatCircleText,
  Calendar,
  Warning,
  ArrowRight,
  Check,
  Eye,
} from '@phosphor-icons/react'
import { useNotifications, type NotificationWithPayload } from '@/lib/hooks/useNotifications'
import { useInspector } from '@/components/layout'
import { NotificationInspector } from '@/components/notification/NotificationInspector'

function getNotificationIcon(type: string, urgent?: boolean) {
  if (urgent) {
    return <Warning className="text-red-500" weight="fill" />
  }

  switch (type) {
    case 'review_request':
      return <Eye className="text-blue-500" />
    case 'client_question':
    case 'client_feedback':
      return <ChatCircleText className="text-amber-500" />
    case 'task_assigned':
    case 'ball_passed':
      return <ArrowRight className="text-indigo-500" />
    case 'due_date_reminder':
      return <Warning className="text-orange-500" />
    case 'meeting_reminder':
    case 'meeting_scheduled':
      return <Calendar className="text-green-500" />
    case 'meeting_ended':
      return <CheckCircle className="text-blue-500" weight="fill" />
    case 'task_completed':
      return <CheckCircle className="text-green-500" weight="fill" />
    case 'confirmation_request':
    case 'urgent_confirmation':
      return <ChatCircleText className="text-amber-500" />
    case 'spec_decision_needed':
      return <Bell className="text-purple-500" />
    default:
      return <Bell className="text-gray-500" />
  }
}

function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMinutes = Math.floor(diffMs / (1000 * 60))
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMinutes < 1) return 'たった今'
  if (diffMinutes < 60) return `${diffMinutes}分前`
  if (diffHours < 24) return `${diffHours}時間前`
  if (diffDays < 7) return `${diffDays}日前`

  return date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

interface NotificationItemProps {
  notification: NotificationWithPayload
  isSelected: boolean
  onClick: () => void
}

function NotificationItem({ notification, isSelected, onClick }: NotificationItemProps) {
  const isUnread = notification.read_at === null
  const payload = notification.payload
  const isUrgent = payload.urgent === true

  return (
    <div
      className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${
        isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
      } ${isUnread && !isSelected ? 'bg-blue-50/30' : ''} ${
        isUrgent ? 'border-l-2 border-l-red-500' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="mt-0.5 text-lg">
          {getNotificationIcon(notification.type, isUrgent)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${isUnread ? 'font-medium text-gray-900' : 'text-gray-700'}`}>
              {payload.title || '通知'}
            </span>
            {isUnread && (
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            )}
          </div>
          <p className="text-sm text-gray-600 mt-0.5 line-clamp-1">
            {payload.message}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {formatTimeAgo(notification.created_at)}
            {payload.from_user_name && ` · ${payload.from_user_name}`}
          </p>
        </div>

        {/* Arrow indicator */}
        <ArrowRight className="text-gray-300 text-sm mt-2 flex-shrink-0" />
      </div>
    </div>
  )
}

function InboxPageContent() {
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const { notifications, loading, error, markAsRead, markAllAsRead } = useNotifications()

  const selectedId = searchParams.get('id')
  const unreadCount = notifications.filter(n => n.read_at === null).length

  // Find selected notification and its index
  const { selectedNotification, selectedIndex } = useMemo(() => {
    if (!selectedId) return { selectedNotification: null, selectedIndex: -1 }
    const index = notifications.findIndex(n => n.id === selectedId)
    return {
      selectedNotification: index >= 0 ? notifications[index] : null,
      selectedIndex: index,
    }
  }, [selectedId, notifications])

  // Update URL without navigation
  const selectNotification = useCallback((id: string | null) => {
    const url = id ? `/inbox?id=${id}` : '/inbox'
    window.history.replaceState(null, '', url)
    // Force re-render by dispatching a custom event
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, [])

  // Navigate to prev/next notification
  const navigateNotification = useCallback((direction: 'prev' | 'next') => {
    if (selectedIndex < 0) return

    const newIndex = direction === 'prev' ? selectedIndex - 1 : selectedIndex + 1
    if (newIndex >= 0 && newIndex < notifications.length) {
      selectNotification(notifications[newIndex].id)
    }
  }, [selectedIndex, notifications, selectNotification])

  // Handle notification click
  const handleNotificationClick = useCallback((notification: NotificationWithPayload) => {
    selectNotification(notification.id)
  }, [selectNotification])

  // Handle close inspector
  const handleCloseInspector = useCallback(() => {
    selectNotification(null)
  }, [selectNotification])

  // Update inspector when selection changes
  useEffect(() => {
    if (selectedNotification) {
      setInspector(
        <NotificationInspector
          notification={selectedNotification}
          onClose={handleCloseInspector}
          onMarkAsRead={markAsRead}
          onNavigate={navigateNotification}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex < notifications.length - 1}
        />
      )
    } else {
      setInspector(null)
    }
  }, [
    selectedNotification,
    selectedIndex,
    notifications.length,
    setInspector,
    handleCloseInspector,
    markAsRead,
    navigateNotification,
  ])

  // Cleanup inspector on unmount
  useEffect(() => {
    return () => {
      setInspector(null)
    }
  }, [setInspector])

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'ArrowUp':
        case 'k':
          e.preventDefault()
          if (selectedIndex > 0) {
            navigateNotification('prev')
          } else if (selectedIndex < 0 && notifications.length > 0) {
            selectNotification(notifications[0].id)
          }
          break
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          if (selectedIndex >= 0 && selectedIndex < notifications.length - 1) {
            navigateNotification('next')
          } else if (selectedIndex < 0 && notifications.length > 0) {
            selectNotification(notifications[0].id)
          }
          break
        case 'Escape':
          e.preventDefault()
          handleCloseInspector()
          break
        case 'Enter':
          e.preventDefault()
          if (selectedNotification?.payload.link) {
            window.location.href = selectedNotification.payload.link
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, notifications, selectedNotification, navigateNotification, selectNotification, handleCloseInspector])

  return (
    <div className="flex-1 flex flex-col">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Tray className="text-lg text-gray-500" />
          受信トレイ
          {unreadCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium bg-blue-500 text-white rounded-full">
              {unreadCount}
            </span>
          )}
        </h1>

        <div className="flex-1" />

        {/* Keyboard hints */}
        <div className="hidden sm:flex items-center gap-2 mr-4 text-[10px] text-gray-400">
          <span className="px-1.5 py-0.5 bg-gray-100 rounded">↑↓</span>
          <span>移動</span>
          <span className="px-1.5 py-0.5 bg-gray-100 rounded">Enter</span>
          <span>詳細へ</span>
        </div>

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllAsRead}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          >
            <Check className="text-sm" />
            すべて既読
          </button>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="text-center text-gray-400 py-16">読み込み中...</div>
        )}

        {error && (
          <div className="text-center text-red-500 py-16">
            {error}
          </div>
        )}

        {!loading && !error && notifications.length === 0 && (
          <div className="text-center text-gray-400 py-20">
            <Tray className="text-4xl mx-auto mb-3 opacity-50" />
            <p className="text-sm">通知はありません</p>
          </div>
        )}

        {!loading && !error && notifications.length > 0 && (
          <div>
            {notifications.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                isSelected={notification.id === selectedId}
                onClick={() => handleNotificationClick(notification)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400">読み込み中...</div>}>
      <InboxPageContent />
    </Suspense>
  )
}
