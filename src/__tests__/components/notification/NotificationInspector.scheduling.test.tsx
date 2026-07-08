import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * Regression test: scheduling_reminder / scheduling_proposal_expired
 * notifications had no way to reach the scheduling response screen, because
 * their payload previously had no `link` (see
 * supabase/migrations/20260706003959_scheduling_notification_links.sql) and
 * NotificationInspector had no type-specific action for them.
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
    type: 'scheduling_reminder',
    dedupe_key: 'dedupe-1',
    payload: {},
    created_at: '2026-07-01T00:00:00',
    read_at: null,
    actioned_at: null,
    ...overrides,
  } as NotificationWithPayload
}

const noop = () => {}

describe('NotificationInspector — scheduling notification action', () => {
  it('shows a "日程を回答する" action linking to payload.link for scheduling_reminder', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'scheduling_reminder',
          payload: { link: '/org-1/project/space-1/meetings?proposal=p1', message: '回答してください' },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    const link = screen.getByRole('link', { name: /日程を回答する/ })
    expect(link).toHaveAttribute('href', '/org-1/project/space-1/meetings?proposal=p1')
  })

  it('shows a "日程を回答する" action linking to payload.link for scheduling_proposal_expired', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'scheduling_proposal_expired',
          payload: { link: '/portal/scheduling', message: '期限切れになりました' },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    const link = screen.getByRole('link', { name: /日程を回答する/ })
    expect(link).toHaveAttribute('href', '/portal/scheduling')
  })

  it('does not show the scheduling action when payload has no link', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'scheduling_reminder',
          payload: { message: '回答してください' },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    expect(screen.queryByRole('link', { name: /日程を回答する/ })).not.toBeInTheDocument()
  })
})
