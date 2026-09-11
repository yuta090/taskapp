import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalTaskDetailClient } from '@/app/portal/task/[taskId]/PortalTaskDetailClient'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

const mockRefresh = vi.fn()
const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush, replace: vi.fn() }),
  usePathname: () => '/portal/task/task-1',
}))

// PortalLeftNav (rendered by PortalShell) calls useCurrentUser() unconditionally.
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }

const task = {
  id: 'task-1',
  title: 'ロゴのご確認',
  description: '',
  status: 'considering',
  ball: 'client',
  type: 'task' as const,
  dueDate: null,
  createdAt: '2026-06-20T00:00:00+09:00',
  updatedAt: '2026-06-20T00:00:00+09:00',
  waitingDays: 0,
  isOverdue: false,
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/**
 * 承認/修正依頼が409で止まったとき、API が理由(reason: 'blocked')付きで返した
 * 具体的なメッセージ（例: 見積もり確認が必要・社内レビュー未完了）はそのまま出し、
 * 本当に他の誰かが先に操作していた場合(reasonなし)だけ既存の汎用文言を出す。
 */
describe('PortalTaskDetailClient — 409 の文言', () => {
  it('承認: reason: blocked のときは API が返した具体的な理由をそのまま出す', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: '社内レビューが完了していないため承認できません',
        reason: 'blocked',
      }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /承認する/ }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('社内レビューが完了していないため承認できません')
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('承認: reason が無いときは、本当に先に操作された場合の既存の汎用文言を出す', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'タスクの状態が変更されました。ページを再読み込みしてください。' }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /承認する/ }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('他のユーザーが先に操作しました。画面を更新します。')
    )
  })

  it('修正を依頼: reason: blocked のときは API が返した具体的な理由をそのまま出す', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: '見積もりの確認が必要です。見積もりを承認または再見積もり依頼してください。',
        reason: 'blocked',
      }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('コメントを入力（任意）'), {
      target: { value: '直してください' },
    })
    fireEvent.click(screen.getByRole('button', { name: /修正を依頼/ }))

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        '見積もりの確認が必要です。見積もりを承認または再見積もり依頼してください。'
      )
    )
  })
})

/**
 * この画面（タスク詳細）は見積もり・社内レビュー・決定事項の状態を表示しない
 * ので、業務ルールで止まっている(reason: 'blocked')409 で取り直しても表示は
 * 変わらない。理由の文言を出すだけにする。一方、本当に他の誰かが先に操作して
 * いた(reason 無し)409 は状態が変わっているので取り直しが要る。
 * ⚠ 将来この画面に見積もりの承認ボタン等を足すときは取り直しを戻すこと。
 */
describe('PortalTaskDetailClient — 409 での再読み込み', () => {
  it('承認: reason: blocked のときは router.refresh() を呼ばない', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: '社内レビューが完了していないため承認できません',
        reason: 'blocked',
      }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /承認する/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('承認: reason が無い(本当に先に操作された)ときは router.refresh() を呼ぶ', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'タスクの状態が変更されました。ページを再読み込みしてください。' }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /承認する/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('修正を依頼: reason: blocked のときは router.refresh() を呼ばない', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: '見積もりの確認が必要です。見積もりを承認または再見積もり依頼してください。',
        reason: 'blocked',
      }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('コメントを入力（任意）'), {
      target: { value: '直してください' },
    })
    fireEvent.click(screen.getByRole('button', { name: /修正を依頼/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('修正を依頼: reason が無いときは router.refresh() を呼ぶ', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'タスクの状態が変更されました。ページを再読み込みしてください。' }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('コメントを入力（任意）'), {
      target: { value: '直してください' },
    })
    fireEvent.click(screen.getByRole('button', { name: /修正を依頼/ }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockRefresh).toHaveBeenCalled()
  })
})

/**
 * 承認・修正依頼の成功後は router.push('/portal') で /portal に遷移するだけで
 * よい。/portal は動的なページなので遷移先で最新のデータが取得され、直後に
 * router.refresh() を呼ぶと /portal を2回読むだけの無駄になる。
 */
describe('PortalTaskDetailClient — 成功後の遷移', () => {
  it('承認が成功したら push だけで、refresh は呼ばない', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /承認する/ }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portal'))
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('修正依頼が成功したら push だけで、refresh は呼ばない', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={task}
        comments={[]}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('コメントを入力（任意）'), {
      target: { value: '直してください' },
    })
    fireEvent.click(screen.getByRole('button', { name: /修正を依頼/ }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portal'))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
