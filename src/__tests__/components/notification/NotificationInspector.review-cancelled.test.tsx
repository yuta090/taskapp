import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * review_cancelled is a non-actionable notice (see
 * src/lib/notifications/classify.ts) fired by rpc_review_cancel
 * (supabase/migrations/20260706171339_review_cancel_notification.sql) to tell
 * a pending reviewer or the review requester that a review was withdrawn and
 * no action is required. It must not render the review_request approve/block
 * action panel.
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: vi.fn(),
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })) },
  }),
}))

function makeNotification(overrides: Partial<NotificationWithPayload> = {}): NotificationWithPayload {
  return {
    id: 'n1',
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'user-1',
    channel: 'in_app',
    type: 'review_cancelled',
    dedupe_key: 'dedupe-1',
    payload: {},
    created_at: '2026-07-06T00:00:00',
    read_at: null,
    actioned_at: null,
    ...overrides,
  } as NotificationWithPayload
}

const noop = () => {}

describe('NotificationInspector — review_cancelled notice', () => {
  it('shows the "レビュー取消" type label in the header', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          payload: { title: 'レビュー取消: 「デザイン修正」', message: 'このレビュー依頼は取り消されました。対応は不要です。' },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    expect(screen.getByText('レビュー取消')).toBeInTheDocument()
  })

  it('does not show the review approve/block action panel', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          payload: { title: 'レビュー取消', message: '対応は不要です。' },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    expect(screen.queryByRole('button', { name: /承認する/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /差し戻す/ })).not.toBeInTheDocument()
  })

  it('shows a "詳細を見る" link when payload.link is present', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          payload: {
            title: 'レビュー取消',
            message: '対応は不要です。',
            link: '/org-1/project/space-1?task=task-1',
          },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    const link = screen.getByRole('link', { name: /詳細を見る/ })
    expect(link).toHaveAttribute('href', '/org-1/project/space-1?task=task-1')
  })
})
