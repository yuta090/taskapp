'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  XCircle,
  CaretDown,
  Funnel,
  File,
} from '@phosphor-icons/react'
import { EmptyState, ErrorRetry, LoadingState, TruncatedText } from '@/components/shared'
import { WARNING } from '@/lib/design/tokens'
import { useNotifications, type NotificationWithPayload } from '@/lib/hooks/useNotifications'
import { useUnreadNotificationCount } from '@/lib/hooks/useUnreadNotificationCount'
import { INBOX_UNREAD_LIMIT } from '@/lib/notifications/inboxLimits'
import { isActionableNotification } from '@/lib/notifications/classify'
import { isSafeInternalPath } from '@/lib/auth/safeRedirect'
import { useInspector } from '@/components/layout'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { NotificationInspector } from '@/components/notification/NotificationInspector'

// ── Filter types & constants ──

type ReadFilter = 'all' | 'unread' | 'read'
type ActionFilter = 'all' | 'actionable' | 'actioned'

const NOTIFICATION_TYPE_GROUPS: ReadonlyArray<{ label: string; types: ReadonlyArray<string> }> = [
  { label: 'レビュー', types: ['review_request', 'review_cancelled'] },
  { label: 'クライアント連絡', types: ['client_question', 'client_feedback'] },
  { label: '確認依頼', types: ['confirmation_request', 'urgent_confirmation'] },
  { label: 'タスク割り当て', types: ['task_assigned', 'ball_passed'] },
  { label: '期限リマインド', types: ['due_date_reminder'] },
  { label: '会議関連', types: ['meeting_reminder', 'meeting_scheduled', 'meeting_ended'] },
  { label: 'タスク完了', types: ['task_completed', 'github_pr_merged'] },
  { label: '仕様決定', types: ['spec_decision_needed'] },
  { label: 'ファイル', types: ['file_uploaded'] },
]

// ── Type filter dropdown ──

function TypeFilterDropdown({
  selectedTypes,
  onChange,
}: {
  selectedTypes: ReadonlySet<string>
  onChange: (types: ReadonlySet<string>) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const hasFilter = selectedTypes.size > 0

  const toggleGroup = (types: ReadonlyArray<string>) => {
    const next = new Set(selectedTypes)
    const allSelected = types.every(t => next.has(t))
    if (allSelected) {
      types.forEach(t => next.delete(t))
    } else {
      types.forEach(t => next.add(t))
    }
    onChange(next)
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`px-2 py-1 text-[11px] rounded-md transition-colors border flex items-center gap-1 ${
          hasFilter
            ? 'border-blue-200 bg-blue-50 text-blue-700'
            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
        }`}
      >
        <Funnel className="text-xs" />
        種別{hasFilter ? `(${selectedTypes.size})` : ''}
        <CaretDown className="text-xs" />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-48 bg-surface border border-gray-200 rounded-lg shadow-lg z-50 py-1">
          {NOTIFICATION_TYPE_GROUPS.map(group => {
            const allSelected = group.types.every(t => selectedTypes.has(t))
            return (
              <label
                key={group.label}
                className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => toggleGroup(group.types)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                {group.label}
              </label>
            )
          })}
          {hasFilter && (
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="w-full text-left px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50"
              >
                クリア
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Icons are monochrome — color is applied by row state, not icon type.
// Shape conveys notification type; color conveys read/unread state.
function getNotificationIcon(type: string) {
  switch (type) {
    case 'review_request':
      return <Eye />
    case 'review_cancelled':
      return <XCircle />
    case 'client_question':
    case 'client_feedback':
    case 'confirmation_request':
    case 'urgent_confirmation':
      return <ChatCircleText />
    case 'task_assigned':
    case 'ball_passed':
      return <ArrowRight />
    case 'due_date_reminder':
      return <Warning />
    case 'meeting_reminder':
    case 'meeting_scheduled':
      return <Calendar />
    case 'meeting_ended':
    case 'task_completed':
    case 'github_pr_merged':
      return <CheckCircle weight="fill" />
    case 'spec_decision_needed':
      return <Bell />
    case 'file_uploaded':
      return <File />
    default:
      return <Bell />
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
  /** 押された通知の id を受け取る。行ごとに新しい関数を作らないので、memo で描き直しを省ける */
  onSelect: (id: string) => void
}

// 一覧は新しい50件＋未読（最大200件）。↑↓ で移るたび・既読になるたびに全行を描き直さないよう memo にする
const NotificationItem = memo(function NotificationItem({ notification, isSelected, onSelect }: NotificationItemProps) {
  const onClick = () => onSelect(notification.id)
  const isUnread = notification.read_at === null
  const payload = notification.payload
  const isUrgent = payload.urgent === true
  const isActionable = isActionableNotification(notification.type)
  const isActioned = notification.actioned_at != null

  // Row background: selected > default
  const rowClass = isSelected ? 'bg-blue-50/60' : ''

  // Left border: only 2 states — urgent (red) and selected (blue). Everything else transparent.
  const borderClass = isUrgent && isUnread
    ? 'border-l-2 border-l-red-500'
    : isSelected
      ? 'border-l-2 border-l-blue-500'
      : 'border-l-2 border-l-transparent'

  // Single badge per row. Priority: 緊急 > 要対応 > 対応済み
  const badge = isUrgent && isUnread
    ? <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-700 rounded font-medium flex-shrink-0">緊急</span>
    : isActionable && !isActioned
      ? <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
          isUnread ? WARNING.badge : WARNING.badgeMuted
        }`}>要対応</span>
      : isActioned
        ? <span className="text-[10px] text-gray-400 flex-shrink-0">対応済み</span>
        : null

  return (
    <div
      role="button"
      tabIndex={0}
      className={`px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer ${rowClass} ${borderClass}`}
      onClick={onClick}
      onKeyDown={(e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <div className="flex items-start gap-3">
        {/* Icon — monochrome, dimmed when read */}
        <div className={`mt-0.5 text-lg flex-shrink-0 ${isUnread ? 'text-gray-500' : 'text-gray-300'}`}>
          {getNotificationIcon(notification.type)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <TruncatedText
              className={`text-sm ${
                isUnread ? 'font-medium text-gray-900' : 'text-gray-500'
              }`}
            >
              {payload.title || '通知'}
            </TruncatedText>
            {badge}
          </div>
          <p className={`text-sm mt-0.5 line-clamp-1 ${isUnread ? 'text-gray-600' : 'text-gray-400'}`}>
            {payload.message}
          </p>
          <p className="text-xs mt-1 text-gray-400 truncate">
            {formatTimeAgo(notification.created_at)}
            {payload.from_user_name && ` · ${payload.from_user_name}`}
            {notification.space_name && ` · ${notification.space_name}`}
          </p>
        </div>

        {/* Unread dot — fixed-width slot to prevent layout shift */}
        <span className="w-2 flex-shrink-0 mt-2 flex justify-center">
          {isUnread && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
        </span>
      </div>
    </div>
  )
})

export default function InboxClient() {
  const searchParams = useSearchParams()
  const { setInspector } = useInspector()
  const { notifications, loading, error, fetchNotifications, markAsRead, markAsActioned, markAllAsRead } = useNotifications()

  // 全体の未読（左メニューのバッジと同じ件数・同じキャッシュ）。一覧に読み込むのは新しい50件＋未読（最大200件）なので、
  // それより古い未読がたまっていれば、一覧の下に件数だけ出す
  const { count: totalUnreadCount } = useUnreadNotificationCount()

  const selectedId = searchParams.get('id')
  const loadedUnreadCount = notifications.filter(n => n.read_at === null).length
  // 見出しの件数はバッジとそろえる（全体の件数がまだ届いていないときは、読み込んだ分を出す）
  const unreadCount = Math.max(loadedUnreadCount, totalUnreadCount)
  // 未読を上限まで読み込んでも全体のほうが多い＝さらに古い未読がある。上限に届いていないのに全体のほうが多いのは、
  // 一覧を読んだあとに届いた分（一覧を取り直せば出る）なので「さらに古い」とは出さない
  const olderUnreadCount = loadedUnreadCount >= INBOX_UNREAD_LIMIT ? unreadCount - loadedUnreadCount : 0

  // ── Filter state ──
  const [readFilter, setReadFilter] = useState<ReadFilter>('all')
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all')
  const [typeFilter, setTypeFilter] = useState<ReadonlySet<string>>(new Set())

  const hasActiveFilters = readFilter !== 'all' || actionFilter !== 'all' || typeFilter.size > 0

  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      // Read status filter。開いている通知は開いた時点で既読になるので、ここでは外さない
      // （外すと「未読のみ」で開いた瞬間に一覧から消え、詳細も閉じてしまう）
      const isOpen = n.id === selectedId
      if (readFilter === 'unread' && n.read_at !== null && !isOpen) return false
      if (readFilter === 'read' && n.read_at === null && !isOpen) return false

      // Actionable filter
      if (actionFilter === 'actionable') {
        if (!isActionableNotification(n.type) || n.actioned_at != null) return false
      }
      if (actionFilter === 'actioned') {
        if (n.actioned_at == null) return false
      }

      // Type filter
      if (typeFilter.size > 0 && !typeFilter.has(n.type)) return false

      return true
    })
  }, [notifications, readFilter, actionFilter, typeFilter, selectedId])

  // Find selected notification and its index within the filtered list
  const { selectedNotification, selectedIndex } = useMemo(() => {
    if (!selectedId) return { selectedNotification: null, selectedIndex: -1 }
    const index = filteredNotifications.findIndex(n => n.id === selectedId)
    return {
      selectedNotification: index >= 0 ? filteredNotifications[index] : null,
      selectedIndex: index,
    }
  }, [selectedId, filteredNotifications])

  // 開いた通知は既読にする（一覧で押す・↑↓で移る・メールやプッシュのリンクから直接開く、のどれでも）。
  // 以前は「既読にして次へ」などを押したときだけ既読になり、開いて読んでもバッジが消えなかった。
  // 描き直しのたびに二重に呼ばないよう、既読にしに行った通知を覚えておく。
  const markedReadIdsRef = useRef(new Set<string>())
  useEffect(() => {
    if (!selectedNotification || selectedNotification.read_at !== null) return
    if (markedReadIdsRef.current.has(selectedNotification.id)) return
    markedReadIdsRef.current.add(selectedNotification.id)
    void markAsRead(selectedNotification.id)
  }, [selectedNotification, markAsRead])

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
    if (newIndex >= 0 && newIndex < filteredNotifications.length) {
      selectNotification(filteredNotifications[newIndex].id)
    }
  }, [selectedIndex, filteredNotifications, selectNotification])

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
          onMarkAsActioned={markAsActioned}
          onNavigate={navigateNotification}
          hasPrev={selectedIndex > 0}
          hasNext={selectedIndex < filteredNotifications.length - 1}
        />
      )
    } else {
      setInspector(null)
    }
  }, [
    selectedNotification,
    selectedIndex,
    filteredNotifications.length,
    setInspector,
    handleCloseInspector,
    markAsRead,
    markAsActioned,
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
          } else if (selectedIndex < 0 && filteredNotifications.length > 0) {
            selectNotification(filteredNotifications[0].id)
          }
          break
        case 'ArrowDown':
        case 'j':
          e.preventDefault()
          if (selectedIndex >= 0 && selectedIndex < filteredNotifications.length - 1) {
            navigateNotification('next')
          } else if (selectedIndex < 0 && filteredNotifications.length > 0) {
            selectNotification(filteredNotifications[0].id)
          }
          break
        case 'Escape':
          e.preventDefault()
          handleCloseInspector()
          break
        case 'Enter': {
          e.preventDefault()
          const link = selectedNotification?.payload.link
          if (isSafeInternalPath(link)) {
            window.location.href = link
          }
          break
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedIndex, filteredNotifications, selectedNotification, navigateNotification, selectNotification, handleCloseInspector])

  return (
    <div className="flex-1 flex flex-col min-h-0">
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
        {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
            AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
            モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
        <div data-header-bell className="hidden md:block ml-1">
          <AnnouncementBell />
        </div>
      </header>

      {/* Filter bar */}
      <div className="border-b border-gray-100 px-5 py-2 flex items-center gap-2 flex-shrink-0 flex-wrap">
        {/* Read status filter */}
        {([
          ['all', 'すべて'],
          ['unread', '未読のみ'],
          ['read', '既読のみ'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setReadFilter(value)}
            className={`px-2 py-1 text-[11px] rounded-md transition-colors border ${
              readFilter === value
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}

        <span className="w-px h-4 bg-gray-200" />

        {/* Actionable filter */}
        {([
          ['all', 'すべて'],
          ['actionable', '要対応'],
          ['actioned', '対応済み'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActionFilter(value)}
            className={`px-2 py-1 text-[11px] rounded-md transition-colors border ${
              actionFilter === value
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}

        <span className="w-px h-4 bg-gray-200" />

        {/* Type filter dropdown */}
        <TypeFilterDropdown
          selectedTypes={typeFilter}
          onChange={setTypeFilter}
        />

        {hasActiveFilters && (
          <button
            type="button"
            onClick={() => {
              setReadFilter('all')
              setActionFilter('all')
              setTypeFilter(new Set())
            }}
            className="px-2 py-1 text-[11px] rounded-md transition-colors text-gray-500 hover:text-gray-700 hover:bg-gray-50"
          >
            リセット
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && <LoadingState />}

        {error && <ErrorRetry message={error} onRetry={fetchNotifications} />}

        {!loading && !error && notifications.length === 0 && (
          <EmptyState
            icon={<Tray />}
            message="クライアントの承認・修正依頼やボールの受け渡しがここに届きます。まずはタスクを作成してクライアントに公開してみましょう。"
          />
        )}

        {!loading && !error && notifications.length > 0 && filteredNotifications.length === 0 && (
          <EmptyState icon={<Funnel />} message="フィルター条件に一致する通知はありません" />
        )}

        {!loading && !error && filteredNotifications.length > 0 && (
          <div>
            {filteredNotifications.map(notification => (
              <NotificationItem
                key={notification.id}
                notification={notification}
                isSelected={notification.id === selectedId}
                onSelect={selectNotification}
              />
            ))}
          </div>
        )}

        {!loading && !error && olderUnreadCount > 0 && (
          <p className="px-4 py-3 text-xs text-gray-500">
            さらに古い未読が {olderUnreadCount} 件あります。「すべて既読」で片付けられます。
          </p>
        )}
      </div>
    </div>
  )
}
