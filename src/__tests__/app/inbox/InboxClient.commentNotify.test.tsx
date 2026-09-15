import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * コメント・メンション通知(comment_added / mention)が受信トレイの
 * 種別フィルタに正しく分類されて表示されることを確かめる。
 */

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

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
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
    type: 'comment_added',
    dedupe_key: 'k1',
    payload: { title: 'コメント', message: '確認お願いします' },
    read_at: null,
    actioned_at: null,
    created_at: '2026-09-10T00:00:00Z',
    ...overrides,
  } as NotificationWithPayload
}

beforeEach(() => {
  mockNotifications = []
})

describe('InboxClient — コメント・メンション通知の分類', () => {
  it('comment_added / mention の両方を出す（未読の既定表示）', () => {
    mockNotifications = [
      makeNotification({ id: 'n1', type: 'comment_added', payload: { title: '新しいコメント' } }),
      makeNotification({ id: 'n2', type: 'mention', payload: { title: '呼ばれました' } }),
    ]
    render(<InboxClient />)

    expect(screen.getByText('新しいコメント')).toBeInTheDocument()
    expect(screen.getByText('呼ばれました')).toBeInTheDocument()
  })

  it('種別フィルタに「コメント」があり、選ぶと comment_added / mention だけに絞れる', () => {
    mockNotifications = [
      makeNotification({ id: 'n1', type: 'comment_added', payload: { title: '新しいコメント' } }),
      makeNotification({ id: 'n2', type: 'mention', payload: { title: '呼ばれました' } }),
      makeNotification({ id: 'n3', type: 'task_assigned', payload: { title: 'タスク割り当て通知' } }),
    ]
    render(<InboxClient />)

    fireEvent.click(screen.getByRole('button', { name: /種別/ }))
    fireEvent.click(screen.getByLabelText('コメント'))

    expect(screen.getByText('新しいコメント')).toBeInTheDocument()
    expect(screen.getByText('呼ばれました')).toBeInTheDocument()
    expect(screen.queryByText('タスク割り当て通知')).not.toBeInTheDocument()
  })
})
