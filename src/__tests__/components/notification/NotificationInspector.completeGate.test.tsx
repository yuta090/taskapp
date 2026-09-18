import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NotificationInspector } from '@/components/notification/NotificationInspector'
import type { NotificationWithPayload } from '@/lib/hooks/useNotifications'

/**
 * 受信トレイの「関連タスク」でステータスを変えたとき、断られた理由を画面に出す。
 *
 * 2026-09-18 に本番で起きたこと: 社内承認を頼まれた人が受信トレイでステータスを「完了」に
 * したが、DB のトリガー（enforce_review_gate）が「承認が終わっていない」と断るため、
 * 一瞬だけ完了になって黙って元に戻っていた。理由は console にしか出ておらず、
 * 使う人には「押しても何も起きない」ようにしか見えなかった。
 * タスク一覧（useTasks の assertReviewCompletionGate）と議事録（useMinutesTaskActions）は
 * 同じ断られ方を日本語で出しているので、受信トレイもそれに揃える。
 */

const REVIEW_GATE_ERROR = { message: 'Cannot complete task: review is not approved', code: 'P0001' }

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

/** update の戻り（テストごとに差し替える） */
let updateResult: { data: unknown; error: unknown } = { data: null, error: REVIEW_GATE_ERROR }
const updateSpy = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'tasks') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: task, error: null }) }) }),
          update: (patch: unknown) => {
            updateSpy(patch)
            return { eq: () => ({ select: () => Promise.resolve(updateResult) }) }
          },
        }
      }
      // review_approvals: 承認待ちの1件を返す（承認アクションを出す条件）
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

function makeNotification(overrides: Partial<NotificationWithPayload> = {}): NotificationWithPayload {
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
    ...overrides,
  } as NotificationWithPayload
}

const noop = () => {}

function renderInspector(notification: NotificationWithPayload) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <NotificationInspector
        notification={notification}
        onClose={noop}
        onMarkAsRead={noop}
        onNavigate={noop}
        hasPrev={false}
        hasNext={false}
      />
    </QueryClientProvider>
  )
}

/** ステータスのボタンを開いて「完了」を選ぶ */
async function chooseDone() {
  const statusButton = await screen.findByRole('button', { name: /社内承認中/ })
  fireEvent.click(statusButton)
  const doneOption = await screen.findByRole('button', { name: '完了' })
  fireEvent.click(doneOption)
}

describe('NotificationInspector — 完了にできないときの理由', () => {
  beforeEach(() => {
    updateResult = { data: null, error: REVIEW_GATE_ERROR }
    updateSpy.mockClear()
  })

  it('社内承認が終わっていないときは、その理由を画面に出す', async () => {
    renderInspector(makeNotification())

    await chooseDone()

    expect(
      await screen.findByText('社内の承認が終わっていないので、まだ完了にできません')
    ).toBeInTheDocument()
    // 英語のままのDBメッセージは出さない
    expect(screen.queryByText(/Cannot complete task/)).not.toBeInTheDocument()
  })

  it('断られたら表示も元のステータスに戻す', async () => {
    renderInspector(makeNotification())

    await chooseDone()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /社内承認中/ })).toBeInTheDocument()
    })
  })

  it('権限が無くて0行だったときは、そのことが分かる文を出す', async () => {
    updateResult = { data: [], error: null }
    renderInspector(makeNotification())

    await chooseDone()

    expect(
      await screen.findByText(/権限が無いか、削除された可能性があります/)
    ).toBeInTheDocument()
  })

  it('うまくいったときは理由を出さない', async () => {
    updateResult = { data: [{ id: 'task-1' }], error: null }
    renderInspector(makeNotification())

    await chooseDone()

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ status: 'done' })
    })
    expect(
      screen.queryByText('社内の承認が終わっていないので、まだ完了にできません')
    ).not.toBeInTheDocument()
  })
})
