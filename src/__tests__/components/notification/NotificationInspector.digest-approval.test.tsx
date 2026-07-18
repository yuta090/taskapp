import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * digest_approval_request（Stage 2.7-B §5b）: 通知センターから申し送りを承認/却下できる。
 * 承認/却下は POST /api/channels/digest-tasks/approval を叩き、RPCが承認者本人を再判定する。
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
    type: 'digest_approval_request',
    dedupe_key: 'digest_approval:task-1',
    payload: { title: '酒屋へ発注', digest_task_id: 'task-1', group_name: 'A社' },
    created_at: '2026-07-15T00:00:00',
    read_at: null,
    actioned_at: null,
    ...overrides,
  } as NotificationWithPayload
}

const noop = () => {}
const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'promoted' }) })
})

function renderInspector(over: Partial<NotificationWithPayload> = {}) {
  render(
    <NotificationInspector
      notification={makeNotification(over)}
      onClose={noop}
      onMarkAsRead={noop}
      onNavigate={noop}
      hasPrev={false}
      hasNext={false}
    />,
  )
}

describe('NotificationInspector — digest approval action', () => {
  it('承認ボタンで approve を approval API に送る', async () => {
    renderInspector()
    fireEvent.click(screen.getByRole('button', { name: /承認してタスク化/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/channels/digest-tasks/approval')
    expect(JSON.parse(opts.body)).toEqual({ orgId: 'org-1', taskId: 'task-1', action: 'approve' })
    expect(await screen.findByText('タスク化しました')).toBeInTheDocument()
  })

  it('却下ボタンで reject を送る', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: 'rejected' }) })
    renderInspector()
    fireEvent.click(screen.getByRole('button', { name: /却下/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe('reject')
    expect(await screen.findByText('却下しました')).toBeInTheDocument()
  })

  it('409（他経路で処理済み）は矛盾扱いにせず完了表示にする', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'conflict' }) })
    renderInspector()
    fireEvent.click(screen.getByRole('button', { name: /承認してタスク化/ }))
    expect(await screen.findByText('処理済みです')).toBeInTheDocument()
  })

  it('403（承認者本人でない）はエラー表示', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'forbidden' }) })
    renderInspector()
    fireEvent.click(screen.getByRole('button', { name: /承認してタスク化/ }))
    expect(await screen.findByText(/権限がありません/)).toBeInTheDocument()
  })
})
