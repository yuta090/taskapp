import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * Pressing Enter on a selected notification navigates via
 * window.location.href — this only ever navigates to an app-internal path,
 * never to an external site or a non-http(s) scheme.
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
    type: 'task_assigned',
    dedupe_key: 'k1',
    payload: { title: '通知', message: 'メッセージ' },
    read_at: '2026-09-10T00:00:00Z',
    actioned_at: null,
    created_at: '2026-09-10T00:00:00Z',
    ...overrides,
  } as NotificationWithPayload
}

beforeEach(() => {
  mockSearch = 'id=n1'
  mockNotifications = []
})

describe('InboxClient — Enterキーでの遷移は自アプリ内のパスのみ', () => {
  // jsdom は実際のナビゲーションを行わず、代入自体を「未実装」として握り潰す
  // (location.href が変わらない) ため、遷移の可否は href の setter 呼び出しを
  // スパイして確認する。
  let hrefSetter: Mock<(value: string) => void>
  const originalLocation = window.location

  beforeEach(() => {
    hrefSetter = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(value: string) {
          hrefSetter(value)
        },
        get href() {
          return originalLocation.href
        },
      },
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
  })

  it('自アプリ内のパスへは遷移する', () => {
    mockNotifications = [
      makeNotification({ payload: { title: '通知', link: '/org-1/project/space-1?task=t1' } }),
    ]
    render(<InboxClient />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(hrefSetter).toHaveBeenCalledWith('/org-1/project/space-1?task=t1')
  })

  it('外部サイトへは遷移しない', () => {
    mockNotifications = [makeNotification({ payload: { title: '通知', link: 'https://evil.example.com' } })]
    render(<InboxClient />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(hrefSetter).not.toHaveBeenCalled()
  })

  it('javascript: スキームへは遷移しない', () => {
    mockNotifications = [makeNotification({ payload: { title: '通知', link: 'javascript:alert(1)' } })]
    render(<InboxClient />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(hrefSetter).not.toHaveBeenCalled()
  })

  it('プロトコル相対パス(//)へは遷移しない', () => {
    mockNotifications = [makeNotification({ payload: { title: '通知', link: '//evil.example.com' } })]
    render(<InboxClient />)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(hrefSetter).not.toHaveBeenCalled()
  })
})
