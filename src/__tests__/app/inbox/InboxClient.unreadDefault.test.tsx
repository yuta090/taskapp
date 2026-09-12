import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * 受信トレイは既定で「未読のみ」を出す。
 *
 * 開いている通知だけは、既読になっても一覧に残す（開いた瞬間に行が消えて詳細まで閉じるのを防ぐため）。
 * ただしそれは「開く操作の巻き添えで消さない」ための例外なので、ユーザーが絞り込みを押した時点で
 * 解除する。解除しないと、読み終わった通知が「未読のみ」に居座って「消えない」ように見える。
 */

let mockSearch = ''
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

let mockNotifications: NotificationWithPayload[] = []
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    loading: false,
    error: null,
    fetchNotifications: vi.fn(),
    markAsRead: vi.fn(),
    markAsActioned: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: () => ({ count: 0, pendingCount: 0, loading: false, error: null, refresh: vi.fn() }),
}))

const mockSetInspector = vi.fn()
vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

vi.mock('@/components/notification/NotificationInspector', () => ({
  NotificationInspector: () => null,
}))

function makeNotification(overrides: Partial<NotificationWithPayload> = {}): NotificationWithPayload {
  return {
    id: 'n1',
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'me',
    channel: 'in_app',
    type: 'task_assigned',
    dedupe_key: 'k1',
    payload: { title: 'タスクが割り当てられました', message: '見積もり作成' },
    read_at: null,
    actioned_at: null,
    created_at: '2026-09-10T00:00:00Z',
    ...overrides,
  } as NotificationWithPayload
}

/** setInspector に最後に渡された通知の id（null なら詳細を閉じている） */
function openedNotificationId(): string | null {
  const last = mockSetInspector.mock.calls.at(-1)?.[0] as React.ReactElement<{
    notification: NotificationWithPayload
  }> | null
  return last?.props?.notification?.id ?? null
}

beforeEach(() => {
  mockSearch = ''
  mockNotifications = []
  mockSetInspector.mockClear()
})

describe('InboxClient — 既定は「未読のみ」', () => {
  it('何も操作していない状態では、既読の通知は一覧に出さない', () => {
    mockNotifications = [
      makeNotification({ id: 'n1', read_at: '2026-09-10T01:00:00Z', payload: { title: '読み終わった通知' } }),
      makeNotification({ id: 'n2', read_at: null, payload: { title: 'まだ読んでいない通知' } }),
    ]
    render(<InboxClient />)

    expect(screen.queryByText('読み終わった通知')).not.toBeInTheDocument()
    expect(screen.getByText('まだ読んでいない通知')).toBeInTheDocument()
  })

  it('「未読のみ」のボタンが最初から選ばれている', () => {
    render(<InboxClient />)
    expect(screen.getByRole('button', { name: '未読のみ' }).className).toContain('bg-blue-50')
  })

  it('未読が無いときは、絞り込みのせいだと誤解させずに「未読はありません」と伝える', () => {
    mockNotifications = [
      makeNotification({ id: 'n1', read_at: '2026-09-10T01:00:00Z', payload: { title: '読み終わった通知' } }),
    ]
    render(<InboxClient />)

    expect(screen.getByText(/未読の通知はありません/)).toBeInTheDocument()
  })
})

describe('InboxClient — 読み終わった通知の片付け', () => {
  beforeEach(() => {
    // 開いた直後に既読になった通知（n1）と、まだ未読の通知（n2）
    mockSearch = 'id=n1'
    mockNotifications = [
      makeNotification({ id: 'n1', read_at: '2026-09-10T01:00:00Z', payload: { title: '開いている通知' } }),
      makeNotification({ id: 'n2', read_at: null, payload: { title: '別の未読' } }),
    ]
  })

  it('絞り込みを押すと、開いていて既読になった通知も一覧から消える', () => {
    render(<InboxClient />)
    // 押す前は残っている（開いた巻き添えで消さない）
    expect(screen.getByText('開いている通知')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '未読のみ' }))

    expect(screen.queryByText('開いている通知')).not.toBeInTheDocument()
    expect(screen.getByText('別の未読')).toBeInTheDocument()
  })

  it('一覧から消えても、開いている詳細はそのまま見られる', () => {
    render(<InboxClient />)
    fireEvent.click(screen.getByRole('button', { name: '未読のみ' }))

    expect(openedNotificationId()).toBe('n1')
  })

  it('種別の絞り込みを押したときも同じく片付ける', () => {
    render(<InboxClient />)
    fireEvent.click(screen.getByRole('button', { name: /種別/ }))
    fireEvent.click(screen.getByLabelText('タスク割り当て'))

    // 種別は一致するが、既読なので「未読のみ」で外れる
    expect(screen.queryByText('開いている通知')).not.toBeInTheDocument()
  })

  it('別の通知を開いたら、前に開いていた既読の通知は一覧から消える', () => {
    const { rerender } = render(<InboxClient />)
    mockSearch = 'id=n2'
    rerender(<InboxClient />)

    expect(screen.queryByText('開いている通知')).not.toBeInTheDocument()
    expect(screen.getByText('別の未読')).toBeInTheDocument()
  })
})
