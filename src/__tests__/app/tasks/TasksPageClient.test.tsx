import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'

const mockSetInspector = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: [],
    owners: {},
    reviewStatuses: {},
    loading: false,
    error: null,
    fetchTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    passBall: vi.fn(),
    handleReviewChange: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [] }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ getMemberName: () => null, members: [], loading: false, error: null }),
}))

// 既定は「編集できる」(admin/editor)。閲覧者(viewer)側の挙動は別ファイル
// (TasksPageClient.viewerReadonly.test.tsx) で canEdit:false を明示して検証する。
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, loading: false }),
}))

vi.mock('@/lib/hooks/useRiskForecast', () => ({
  useRiskForecast: () => ({ forecasts: new Map() }),
}))

// お知らせベルは Supabase/組織コンテキストを引くので、取得層だけ差し替えて
// 「ヘッダーのどこに置かれているか」だけを検証する。
vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

// TaskCreateSheet is loaded via next/dynamic and always mounted (gated
// internally by its own `isOpen` prop); the real component pulls in
// useSpaceMembers/useWikiPages/useEstimationAssist. Stub it so the empty-state
// CTA test only has to prove state is wired, not re-test the sheet itself.
vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="task-create-sheet">新規タスク作成</div> : null,
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

/**
 * B-5: the empty task list only hinted at the "N" keyboard shortcut
 * ("Nキーで最初のタスクを作成しましょう") instead of offering a clickable CTA.
 */
describe('TasksPageClient empty state', () => {
  it('shows a "タスクを作成" button when there are no tasks', () => {
    renderPage()
    expect(screen.getByText('タスクはありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'タスクを作成' })).toBeInTheDocument()
  })

  it('clicking the CTA drives the same URL-sync path as the "N" keyboard shortcut (create=1)', () => {
    // isCreateOpen is derived from the URL (searchParams.get('create')), and
    // this component writes it via window.history.replaceState rather than
    // the (mocked, static) next/navigation router — so we assert on the
    // history write instead of a rerendered isCreateOpen/TaskCreateSheet.
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'タスクを作成' }))

    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      expect.stringContaining('create=1')
    )
  })
})

/**
 * ストリームC「クライアント表示プレビュー」入口: このヘッダーから
 * /portal/preview/{spaceId} へ内部ユーザーが遷移できる控えめなリンク。
 */
describe('TasksPageClient client preview entry link', () => {
  it('links to /portal/preview/{spaceId}', () => {
    renderPage()

    const link = screen.getByRole('link', { name: /クライアント表示/ })
    expect(link).toHaveAttribute('href', '/portal/preview/space-1')
  })
})

/**
 * 作成の入口が「一覧最下段の薄い行」だけで、サンプルタスクの下に隠れて見つからなかった。
 * ヘッダーに常設の「タスクを追加」ボタンを置き、操作ガイドの第1ステップがそれをハイライトする。
 */
describe('TasksPageClient header create button', () => {
  it('ヘッダーに「タスクを追加」ボタンが常に出て、操作ガイドの目印(data-walkthrough="task-create")を持つ', () => {
    renderPage()
    const button = screen.getByTestId('task-create-button')
    expect(button).toHaveTextContent('タスクを追加')
    expect(button).toHaveAttribute('data-walkthrough', 'task-create')
    // 操作ガイドは最初に見つかった要素をハイライトする → ヘッダーのボタンが先頭
    expect(document.querySelector('[data-walkthrough="task-create"]')).toBe(button)
  })

  it('押すと作成シートを開く（N キーと同じ create=1 の経路）', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    renderPage()
    fireEvent.click(screen.getByTestId('task-create-button'))
    expect(replaceStateSpy).toHaveBeenCalledWith(null, '', expect.stringContaining('create=1'))
  })
})

/**
 * お知らせベルはページ上部に単独の行として浮いていて、設定ボタンから離れていた。
 * ヘッダーの操作アイコン群（プレビュー・設定）と同じ行にまとめる。
 * 置き場所は全ページ共通で「ヘッダーの一番右」— どの画面でも同じ場所を探せるようにする。
 */
describe('TasksPageClient header announcement bell', () => {
  it('ヘッダーの一番右にあり、設定ボタンより右（DOM順で後ろ）に並ぶ', () => {
    renderPage()

    const bell = screen.getByRole('button', { name: 'お知らせ' })
    const settingsLink = screen.getByTestId('project-settings-link')

    // 同じヘッダー行にいる
    expect(bell.closest('header')).not.toBeNull()
    expect(bell.closest('header')).toBe(settingsLink.closest('header'))
    // DOM順で設定ボタンが先 = 画面上はベルが一番右
    expect(
      settingsLink.compareDocumentPosition(bell) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('AppShell 側の単独ベル行を消すための目印(data-header-bell)を持つ', () => {
    renderPage()
    const bell = screen.getByRole('button', { name: 'お知らせ' })
    expect(bell.closest('[data-header-bell]')).not.toBeNull()
  })
})

/**
 * 「タスクを追加」ボタンの塗り(bg-indigo-600 + 白文字)が強すぎて、
 * 一覧より先に目に入ってしまう。控えめな枠線ボタンに落とす。
 */
describe('TasksPageClient header create button styling', () => {
  it('強い塗り(bg-indigo-600 / 白文字)ではなく、控えめな枠線ボタンになっている', () => {
    renderPage()
    const button = screen.getByTestId('task-create-button')

    expect(button.className).not.toContain('bg-indigo-600')
    expect(button.className).not.toContain('text-white')
    expect(button.className).toContain('border')
  })
})
