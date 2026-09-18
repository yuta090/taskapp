import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * 受信トレイで承認したとき、タスクが完了になったことをその場に出す。
 *
 * 承認がそろうと DB 側（_review_approve_impl）がタスクを完了にする。それまで画面は
 * 「承認しました」とだけ出し、関連タスクのステータスは「社内承認中」のまま残っていたので、
 * 「承認したのにステータスが変わらない」と受け取られていた（2026-09-18 本番）。
 */

const mocks = vi.hoisted(() => ({
  reviewApprove: vi.fn(),
}))

vi.mock('@/lib/supabase/rpc', () => ({
  rpc: {
    reviewApprove: mocks.reviewApprove,
    reviewBlock: vi.fn(),
    setSpecState: vi.fn(),
  },
}))

const task = {
  id: 'task-1',
  org_id: 'org-1',
  space_id: 'space-1',
  title: '9/24セミナーの構成',
  description: null,
  status: 'in_review',
  type: 'task',
  ball: 'internal',
  decision_state: null,
  due_date: null,
  assignee_id: 'user-1',
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'tasks') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: task, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'task-1' }], error: null }) }) }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ limit: () => Promise.resolve({ data: [{ id: 'ra-1' }], error: null }) }),
            }),
          }),
        }),
      }
    },
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
  }),
}))

function makeNotification(): NotificationWithPayload {
  return {
    id: 'n1',
    org_id: 'org-1',
    space_id: 'space-1',
    to_user_id: 'user-1',
    channel: 'in_app',
    type: 'review_request',
    dedupe_key: 'dedupe-1',
    payload: { task_id: 'task-1', title: '承認依頼', message: '承認をお願いします' },
    created_at: '2026-09-18T04:27:00',
    read_at: null,
    actioned_at: null,
  } as NotificationWithPayload
}

const noop = () => {}

function renderInspector(queryClient: QueryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationInspector
        notification={makeNotification()}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    </QueryClientProvider>
  )
}

describe('NotificationInspector — 承認したらタスクの状態も合わせる', () => {
  beforeEach(() => {
    mocks.reviewApprove.mockReset()
  })

  it('承認がそろって完了になったら、完了にしたことを出し、ステータスも完了にする', async () => {
    mocks.reviewApprove.mockResolvedValue({ ok: true, allApproved: true, taskCompleted: true })
    renderInspector()

    fireEvent.click(await screen.findByRole('button', { name: /承認する/ }))

    expect(await screen.findByText('承認しました。タスクを完了にしました')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /完了/ })).toBeInTheDocument()
  })

  it('プロジェクトのタスク一覧のキャッシュも完了にする（一覧に戻っても社内承認中のままにしない）', async () => {
    mocks.reviewApprove.mockResolvedValue({ ok: true, allApproved: true, taskCompleted: true })
    const queryClient = new QueryClient()
    queryClient.setQueryData(['tasks', 'org-1', 'space-1'], {
      tasks: [{ ...task, completed_at: null }],
      owners: {},
      reviewStatuses: { 'task-1': 'open' },
    })
    const before = queryClient.getQueryState(['tasks', 'org-1', 'space-1'])?.dataUpdatedAt
    await new Promise((r) => setTimeout(r, 5))
    renderInspector(queryClient)

    fireEvent.click(await screen.findByRole('button', { name: /承認する/ }))

    await waitFor(() => {
      const data = queryClient.getQueryData<{ tasks: Array<{ status: string }> }>(['tasks', 'org-1', 'space-1'])
      expect(data?.tasks[0].status).toBe('done')
    })
    // 1行直しただけなので取得時刻は動かさない
    expect(queryClient.getQueryState(['tasks', 'org-1', 'space-1'])?.dataUpdatedAt).toBe(before)
  })

  it('ほかの承認者が残っているときは「承認しました」だけ出し、ステータスは動かさない', async () => {
    mocks.reviewApprove.mockResolvedValue({ ok: true, allApproved: false, taskCompleted: false })
    renderInspector()

    fireEvent.click(await screen.findByRole('button', { name: /承認する/ }))

    expect(await screen.findByText('承認しました')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /社内承認中/ })).toBeInTheDocument()
  })
})
