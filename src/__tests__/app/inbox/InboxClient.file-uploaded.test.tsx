import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import InboxClient from '@/app/(internal)/inbox/InboxClient'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * file_uploaded: informational notice (no ball to act on), so it must not be
 * flagged 要対応 like the actionable types, and must render with its own
 * payload.title instead of falling back to the generic "通知" label.
 */

const notifications: NotificationWithPayload[] = [
  {
    id: 'n1',
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'user-1',
    channel: 'in_app',
    type: 'file_uploaded',
    dedupe_key: 'dedupe-1',
    payload: {
      title: 'ファイル: クライアントから資料が届きました',
      message: '山田太郎さんが「見積書.pdf」をアップロードしました',
      link: '/org-1/project/space-1/files',
    },
    created_at: '2026-07-01T00:00:00',
    read_at: null,
    actioned_at: null,
  } as NotificationWithPayload,
]

vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({
    notifications,
    loading: false,
    error: null,
    fetchNotifications: vi.fn(),
    markAsRead: vi.fn(),
    markAsActioned: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

vi.mock('@/components/notification/NotificationInspector', () => ({
  NotificationInspector: () => null,
}))

describe('InboxClient — file_uploaded', () => {
  it('renders the payload title and does not mark it as 要対応', () => {
    render(<InboxClient />)

    expect(screen.getByText('ファイル: クライアントから資料が届きました')).toBeInTheDocument()
    // The "要対応" filter button in the toolbar always renders — only assert
    // the row itself has no 要対応 badge, i.e. no more than that one match.
    expect(screen.getAllByText('要対応')).toHaveLength(1)
  })
})
