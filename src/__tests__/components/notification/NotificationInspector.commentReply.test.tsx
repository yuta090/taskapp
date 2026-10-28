import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * コメント・メンションの通知は、受信トレイの右パネルでそのまま返信できる（タスク詳細と同じコメント欄を出す）。
 */

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null } })) },
  }),
}))

const mockThread = vi.fn()
const mockThreadMount = vi.fn()
vi.mock('@/components/notification/InboxCommentThread', async () => {
  const { useEffect } = await vi.importActual<typeof import('react')>('react')
  return {
    InboxCommentThread: (props: Record<string, unknown>) => {
      mockThread(props)
      useEffect(() => {
        mockThreadMount()
      }, [])
      return <div data-testid="inbox-comment-thread" />
    },
  }
})

function makeNotification(overrides: Partial<NotificationWithPayload> = {}): NotificationWithPayload {
  return {
    id: 'n1',
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'user-1',
    channel: 'in_app',
    type: 'comment_added',
    dedupe_key: 'dedupe-1',
    payload: { task_id: 'task-1', comment_id: 'c1', task_title: 'デザイン確認', message: '確認お願いします' },
    created_at: '2026-10-28T00:00:00',
    read_at: null,
    actioned_at: null,
    ...overrides,
  } as NotificationWithPayload
}

const noop = () => {}

function renderInspector(notification: NotificationWithPayload) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationInspector notification={notification} onClose={noop} onMarkAsRead={noop} onNavigate={noop} hasPrev={false} hasNext={false} />
    </QueryClientProvider>
  )
}

describe('NotificationInspector — コメント通知から返信できる', () => {
  it('comment_added: タスクのコメント欄を、元のコメントを指して出す', () => {
    renderInspector(makeNotification())

    expect(screen.getByTestId('inbox-comment-thread')).toBeInTheDocument()
    expect(mockThread).toHaveBeenLastCalledWith(
      expect.objectContaining({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1', replyToCommentId: 'c1' })
    )
  })

  it('mention: コメント欄を出す', () => {
    renderInspector(makeNotification({ type: 'mention' }))

    expect(screen.getByTestId('inbox-comment-thread')).toBeInTheDocument()
  })

  it('別の通知に切り替えたら、コメント欄を作り直す（前の通知の書きかけ・公開範囲を持ち越さない）', () => {
    mockThreadMount.mockClear()
    const { rerender } = renderInspector(makeNotification())
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NotificationInspector
          notification={makeNotification({ id: 'n2', payload: { task_id: 'task-2', comment_id: 'c2', message: '別件です' } })}
          onClose={noop}
          onMarkAsRead={noop}
          onNavigate={noop}
          hasPrev={false}
          hasNext={false}
        />
      </QueryClientProvider>
    )

    expect(mockThreadMount).toHaveBeenCalledTimes(2)
  })

  it('承認依頼など、コメント以外の通知には出さない', () => {
    renderInspector(makeNotification({ type: 'review_request' }))

    expect(screen.queryByTestId('inbox-comment-thread')).not.toBeInTheDocument()
  })
})
