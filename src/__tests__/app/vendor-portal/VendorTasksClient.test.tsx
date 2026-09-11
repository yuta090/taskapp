import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { VendorTasksClient } from '@/app/vendor-portal/tasks/VendorTasksClient'

/**
 * 協力会社によるタスクのステータス変更は、サーバー側 API
 * (/api/vendor-portal/tasks/[taskId]/status) 経由で行う。楽観的更新はして
 * よいが、失敗したら「まだこの操作で入れた値のままなら」表示を元に戻し、
 * サーバーが返した理由を出す。今のステータスが選べる4状態のどれでもない
 * タスクは、選択肢を出さず状態名の表示だけにする。
 */

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}))

const baseTask = {
  id: 'task-1',
  title: 'ロゴ制作',
  status: 'todo',
  ball: 'vendor',
  due_date: null,
  milestone_id: null,
  priority: null,
  created_at: '2026-09-01T00:00:00',
  updated_at: '2026-09-01T00:00:00',
}

describe('VendorTasksClient — ステータス変更はサーバー側APIで行う', () => {
  beforeEach(() => {
    toastError.mockClear()
    toastSuccess.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('選択肢は4つ（backlog/todo/in_progress/in_review）だけで、完了/検討中は選べない', () => {
    render(
      <VendorTasksClient spaceId="space-1" spaceName="テストプロジェクト" orgId="org-1" tasks={[baseTask]} />
    )

    const select = screen.getByDisplayValue('Todo') as HTMLSelectElement
    const optionLabels = Array.from(select.options).map((o) => o.textContent)
    expect(optionLabels).toEqual(['バックログ', 'Todo', '進行中', 'レビュー中'])
    expect(optionLabels).not.toContain('完了')
    expect(optionLabels).not.toContain('検討中')
  })

  it('今のステータスが選べる4状態のどれでもないタスクは、選択肢を出さず状態名の表示だけにする', () => {
    render(
      <VendorTasksClient
        spaceId="space-1"
        spaceName="テストプロジェクト"
        orgId="org-1"
        tasks={[{ ...baseTask, status: 'considering' }]}
      />
    )

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.getByText('検討中')).toBeInTheDocument()
  })

  it('ステータス変更で /api/vendor-portal/tasks/[taskId]/status に POST する', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'ステータスを更新しました' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <VendorTasksClient spaceId="space-1" spaceName="テストプロジェクト" orgId="org-1" tasks={[baseTask]} />
    )

    fireEvent.change(screen.getByDisplayValue('Todo'), { target: { value: 'in_progress' } })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/vendor-portal/tasks/task-1/status')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ status: 'in_progress' })
  })

  it('成功時のみ成功トーストを出す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, message: 'ステータスを更新しました' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <VendorTasksClient spaceId="space-1" spaceName="テストプロジェクト" orgId="org-1" tasks={[baseTask]} />
    )

    fireEvent.change(screen.getByDisplayValue('Todo'), { target: { value: 'in_progress' } })

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('ステータスを更新しました'))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('失敗時(サーバーがエラーを返す)は表示を元に戻し、サーバーの理由を出す', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'アクセス権限がありません' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <VendorTasksClient spaceId="space-1" spaceName="テストプロジェクト" orgId="org-1" tasks={[baseTask]} />
    )

    const select = screen.getByDisplayValue('Todo') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'in_progress' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('アクセス権限がありません'))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(select.value).toBe('todo')
  })

  it('失敗時(fetch自体が失敗)は表示を元に戻し、汎用の文言を出す', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('fetch', fetchMock)

    render(
      <VendorTasksClient spaceId="space-1" spaceName="テストプロジェクト" orgId="org-1" tasks={[baseTask]} />
    )

    const select = screen.getByDisplayValue('Todo') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'in_progress' } })

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('ステータスの更新に失敗しました'))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(select.value).toBe('todo')
  })

  it('表示が別の変更で上書きされていれば、古い失敗の巻き戻しで上書きしない', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'ステータスを更新しました' }),
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    render(
      <VendorTasksClient spaceId="space-1" spaceName="テストプロジェクト" orgId="org-1" tasks={[baseTask]} />
    )

    const select = screen.getByRole('combobox') as HTMLSelectElement

    // 1回目の変更（応答待ちのまま）
    fireEvent.change(select, { target: { value: 'in_progress' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    // 応答が返るより前に、2回目の変更が先に成功する
    fireEvent.change(select, { target: { value: 'in_review' } })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(select.value).toBe('in_review'))

    // 1回目が失敗として返ってきても、表示は既に別の値に進んでいるので巻き戻さない
    resolveFirst({ ok: false, status: 403, json: async () => ({ error: 'アクセス権限がありません' }) })
    await waitFor(() => expect(toastError).toHaveBeenCalled())

    expect(select.value).toBe('in_review')
  })
})
