import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'

/**
 * 受信トレイは「新しい50件」と「未読（上限200件）」を読む。上限を超えて未読がたまっているときは、
 * 一覧の下に「さらに古い未読が N 件あります」と出し、見出しの件数も左メニューのバッジ（全体の未読）とそろえる。
 * 以前は新しい50件だけを読み、承認の依頼が50件を超えた人は古い依頼が一覧に出ないまま、バッジの数だけ残っていた。
 */

const mocks = vi.hoisted(() => ({
  notifications: [] as unknown[],
  totalUnread: 0,
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications: mocks.notifications,
    loading: false,
    error: null,
    fetchNotifications: vi.fn(),
    markAsRead: vi.fn(),
    markAsActioned: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useUnreadNotificationCount', () => ({
  useUnreadNotificationCount: () => ({
    count: mocks.totalUnread,
    pendingCount: 0,
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

vi.mock('@/components/notification/NotificationInspector', () => ({
  NotificationInspector: () => null,
}))

function makeNotification(id: string, readAt: string | null) {
  return {
    id,
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'me',
    channel: 'in_app',
    type: 'review_request',
    dedupe_key: id,
    payload: { title: `承認の依頼${id}` },
    read_at: readAt,
    actioned_at: null,
    created_at: '2026-09-11T00:00:00Z',
    space_name: null,
  }
}

beforeEach(() => {
  // 読み込めた未読は2件（a, b）
  mocks.notifications = [
    makeNotification('a', null),
    makeNotification('b', null),
    makeNotification('c', '2026-09-11T01:00:00Z'),
  ]
  mocks.totalUnread = 0
})

describe('InboxClient — 上限を超えてたまった古い未読', () => {
  it('未読を上限（200件）まで読み込んでも全体のほうが多ければ、一覧の下に「さらに古い未読が N 件あります」と出す', () => {
    mocks.notifications = Array.from({ length: 200 }, (_, i) => makeNotification(`u${i}`, null))
    mocks.totalUnread = 230
    render(<InboxClient />)
    expect(screen.getByText(/さらに古い未読が 30 件あります/)).toBeInTheDocument()
  })

  it('上限に届いていないのに全体のほうが多いのは、一覧を読んだあとに届いた分なので「さらに古い」とは出さない', () => {
    mocks.totalUnread = 5
    render(<InboxClient />)
    expect(screen.queryByText(/さらに古い未読/)).not.toBeInTheDocument()
  })

  it('見出しの未読の件数は、左メニューのバッジ（全体の未読）とそろえる', () => {
    mocks.totalUnread = 5
    render(<InboxClient />)
    expect(screen.getByRole('heading', { name: /受信トレイ/ })).toHaveTextContent('5')
  })

  it('未読を全部読み込めていれば、何も出さない', () => {
    mocks.totalUnread = 2
    render(<InboxClient />)
    expect(screen.queryByText(/さらに古い未読/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /受信トレイ/ })).toHaveTextContent('2')
  })

  it('全体の件数がまだ届いていない（0）ときは、読み込んだ未読の数を出す', () => {
    render(<InboxClient />)
    expect(screen.queryByText(/さらに古い未読/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /受信トレイ/ })).toHaveTextContent('2')
  })
})
