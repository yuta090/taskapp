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
 * この画面は見積もりの状態でボタンを切り替える（見積もり待ちのときは承認/
 * 修正依頼ではなく見積もりの承認・却下を出す）ので、業務の理由で止まって
 * いる(reason: 'blocked')409 でも取り直して最新の状態を出す。本当に他の
 * 誰かが先に操作していた(reason 無し)409も同様に取り直す。
 */
describe('PortalTaskDetailClient — 409 での再読み込み', () => {
  it('承認: reason: blocked のときも router.refresh() を呼ぶ（見積もり状態が変わった可能性があるため）', async () => {
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
    expect(mockRefresh).toHaveBeenCalled()
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

  it('修正を依頼: reason: blocked のときも router.refresh() を呼ぶ（見積もり状態が変わった可能性があるため）', async () => {
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
    expect(mockRefresh).toHaveBeenCalled()
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

/**
 * 見積もり確認待ちのタスクに「承認する」「修正を依頼」を出すと、サーバーが
 * 409(見積もりの確認が必要)で断って先に進めない。見積もり待ちのときはこの
 * 2つのボタンの代わりに見積もりの承認・再見積もり依頼を出す。
 */
describe('PortalTaskDetailClient — 見積もり確認待ちのタスク', () => {
  const estimateTask = {
    ...task,
    estimatedCost: 80000,
    estimateStatus: 'pending' as const,
  }

  it('見積もり待ちでは「承認する」「修正を依頼」を出さず、見積もりの承認・再見積もり依頼を出す', () => {
    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={estimateTask}
        comments={[]}
      />
    )

    expect(screen.getByRole('button', { name: '見積もり承認' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再見積もり依頼' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /承認する/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /修正を依頼/ })).not.toBeInTheDocument()
    expect(screen.getByText('¥80,000')).toBeInTheDocument()
  })

  it('見積もり承認を押すと estimate_approve で送信し、成功したら /portal に遷移する', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={estimateTask}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '見積もり承認' }))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/portal/tasks/${estimateTask.id}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'estimate_approve', comment: '' }),
        })
      )
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portal'))
  })

  it('再見積もり依頼はコメント未入力だと送信せず、入力すると estimate_reject で送信する', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={estimateTask}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '再見積もり依頼' }))
    expect(global.fetch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByPlaceholderText('コメントを入力（再見積もり依頼時は必須）'), {
      target: { value: 'もう少し安くお願いします' },
    })
    fireEvent.click(screen.getByRole('button', { name: '再見積もり依頼' }))

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/portal/tasks/${estimateTask.id}`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'estimate_reject', comment: 'もう少し安くお願いします' }),
        })
      )
    )
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portal'))
  })

  it('見積もり承認が409のときは赤い通知を出して取り直し、/portal へは移らない', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'タスクの状態が変更されました。ページを再読み込みしてください。',
      }),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={estimateTask}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '見積もり承認' }))

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('見積もりの操作が成功したときは router.refresh() を呼ばない（push だけ）', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({}),
    })

    renderWithProviders(
      <PortalTaskDetailClient
        currentProject={project}
        projects={[project]}
        task={estimateTask}
        comments={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '見積もり承認' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/portal'))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})

/**
 * 二要素認証(6桁コード)が未入力のまま操作すると、サーバー(mfaGuardResponse)は
 * 403 { error: 'mfa_required' } を返す。何をすればよいか分かる文言を出す。
 * それ以外の403（アクセス権限なし）は、これまでどおり汎用の文言にする。
 */
describe('PortalTaskDetailClient — 403 の文言', () => {
  it('mfa_required のときは二要素認証のコード入力を促す文言を出す', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'mfa_required', message: '二要素認証のコード入力が必要です' }),
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
      expect(toastError).toHaveBeenCalledWith(
        expect.stringContaining('二要素認証')
      )
    )
  })

  it('mfa_required 以外の403は、これまでどおりアクセスできない旨の汎用文言を出す', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: 'アクセス権限がありません' }),
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
      expect(toastError).toHaveBeenCalledWith('このタスクにはアクセスできません。')
    )
  })
})

/**
 * 成功後は router.push('/portal') で画面が切り替わるまでボタンを押せない
 * ままにする（連打で二重送信させないため）。失敗したときだけ元に戻す。
 */
describe('PortalTaskDetailClient — 成功後は操作できないままにする', () => {
  it('承認が成功したあとはボタンが無効のまま（処理中の表示が残る）', async () => {
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
    expect(screen.getByRole('button', { name: /承認中/ })).toBeDisabled()
  })

  it('承認が失敗したあとはボタンが元に戻る（再操作できる）', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
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

    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: '承認する' })).not.toBeDisabled()
  })
})
