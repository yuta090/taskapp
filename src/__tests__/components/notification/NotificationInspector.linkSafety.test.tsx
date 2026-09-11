import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * payload.link is only ever rendered as a navigation target when it is an
 * app-internal path — never an external site or a non-http(s) scheme.
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

describe('NotificationInspector — payload.link は自アプリ内のパスのみ表示する', () => {
  it('scheduling 系アクション: 外部サイトへのリンクは表示しない', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'scheduling_reminder',
          payload: { link: 'https://evil.example.com', message: '回答してください' },
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

  it('scheduling 系アクション: javascript: スキームは表示しない', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'scheduling_proposal_expired',
          payload: { link: 'javascript:alert(1)', message: '期限切れになりました' },
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

  it('confirmation_request: 外部サイトへのリンクは表示しない', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'confirmation_request',
          payload: { link: 'https://evil.example.com', message: '確認してください' },
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

  it('urgent_confirmation: javascript: スキームは表示しない', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'urgent_confirmation',
          payload: { link: 'javascript:alert(1)', message: '至急確認してください' },
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

  it('フッターの「詳細を見る」: 外部サイトへのリンクは表示しない', () => {
    render(
      <NotificationInspector
        notification={makeNotification({
          type: 'file_uploaded',
          payload: { link: '//evil.example.com' },
        })}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    )

    expect(screen.queryByRole('link', { name: /詳細を見る/ })).not.toBeInTheDocument()
  })
})
