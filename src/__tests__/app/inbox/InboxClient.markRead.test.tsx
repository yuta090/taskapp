import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * 受信トレイで通知を開いても既読にならず、左メニューのバッジが消えなかった。
 * 以前は「既読にして次へ」などを押したときだけ既読にしていた。開いた時点で既読にする。
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

const mockMarkAsRead = vi.fn()
let mockNotifications: NotificationWithPayload[] = []
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: mockNotifications,
    loading: false,
    error: null,
    fetchNotifications: vi.fn(),
    markAsRead: mockMarkAsRead,
    markAsActioned: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
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

beforeEach(() => {
  mockSearch = ''
  mockNotifications = []
  mockMarkAsRead.mockClear()
  mockSetInspector.mockClear()
})

describe('InboxClient — 開いたら既読にする', () => {
  it('未読の通知を開くと既読にする（何度描き直しても1回だけ）', () => {
    mockSearch = 'id=n1'
    mockNotifications = [makeNotification({ id: 'n1', read_at: null })]
    const { rerender } = render(<InboxClient />)
    rerender(<InboxClient />)
    expect(mockMarkAsRead).toHaveBeenCalledTimes(1)
    expect(mockMarkAsRead).toHaveBeenCalledWith('n1')
  })

  it('既読の通知を開いても、もう一度既読にはしない', () => {
    mockSearch = 'id=n1'
    mockNotifications = [makeNotification({ id: 'n1', read_at: '2026-09-10T01:00:00Z' })]
    render(<InboxClient />)
    expect(mockMarkAsRead).not.toHaveBeenCalled()
  })

  it('一覧を見ているだけ（何も開いていない）なら既読にしない', () => {
    mockNotifications = [makeNotification({ id: 'n1', read_at: null })]
    render(<InboxClient />)
    expect(mockMarkAsRead).not.toHaveBeenCalled()
  })

  it('「未読のみ」で開いた通知は、既読になっても一覧と詳細から消えない', () => {
    // 開いた直後に既読になった状態（n1）と、まだ未読の別の通知（n2）
    mockSearch = 'id=n1'
    mockNotifications = [
      makeNotification({ id: 'n1', read_at: '2026-09-10T01:00:00Z', payload: { title: '開いている通知' } }),
      makeNotification({ id: 'n2', read_at: null, payload: { title: '別の未読' } }),
    ]
    render(<InboxClient />)
    fireEvent.click(screen.getByRole('button', { name: '未読のみ' }))

    expect(screen.getByText('開いている通知')).toBeInTheDocument()
    expect(screen.getByText('別の未読')).toBeInTheDocument()
    const lastInspector = mockSetInspector.mock.calls.at(-1)?.[0] as React.ReactElement<{
      notification: NotificationWithPayload
    }> | null
    expect(lastInspector?.props.notification.id).toBe('n1')
  })

  it('「未読のみ」では、開いていない既読の通知は出さない', () => {
    mockSearch = 'id=n2'
    mockNotifications = [
      makeNotification({ id: 'n1', read_at: '2026-09-10T01:00:00Z', payload: { title: '読んだ通知' } }),
      makeNotification({ id: 'n2', read_at: null, payload: { title: '開いている未読' } }),
    ]
    render(<InboxClient />)
    fireEvent.click(screen.getByRole('button', { name: '未読のみ' }))
    expect(screen.queryByText('読んだ通知')).not.toBeInTheDocument()
  })
})
