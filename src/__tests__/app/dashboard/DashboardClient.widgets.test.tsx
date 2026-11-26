import React from 'react'
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DashboardClient } from '@/app/(internal)/[orgId]/project/[spaceId]/dashboard/DashboardClient'
import { DASHBOARD_WIDGETS, DASHBOARD_WIDGET_PREFS_KEY } from '@/lib/dashboard/widgetPrefs'
import type { Task } from '@/types/database'
import type { ActivityRow } from '@/lib/dashboard/activity'

/**
 * ダッシュボードに足した「期限切れ」「最近のコメント」と、表示する項目を選ぶメニュー。
 */

function task(overrides: Partial<Task>): Task {
  return {
    id: 't',
    title: 'タスク',
    status: 'todo',
    ball: 'internal',
    due_date: null,
    milestone_id: null,
    updated_at: '2026-09-16T00:00:00Z',
    ...overrides,
  } as Task
}

const mocks = vi.hoisted(() => ({
  tasks: [] as Task[],
  reviewStatuses: {} as Record<string, string>,
  recentComments: [] as Array<{ id: string; task_id: string; actor_id: string; body: string; created_at: string }>,
  recentCommentsEnabled: [] as boolean[],
  membersPending: false,
  decisionEvents: [] as Array<{ task_id: string; action: string; created_at: string }>,
  decisionEventsEnabled: [] as boolean[],
  activityRows: [] as ActivityRow[],
  activityEnabled: [] as boolean[],
  activityError: null as unknown,
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: mocks.tasks,
    reviewStatuses: mocks.reviewStatuses,
    loading: false,
    error: null,
    fetchTasks: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/useMilestones', () => ({ useMilestones: () => ({ milestones: [], loading: false }) }))
vi.mock('@/lib/hooks/useWeekWikiActivity', () => ({
  useWeekWikiActivity: () => ({ pages: [], loading: false, error: null }),
}))
vi.mock('@/lib/hooks/useMeetings', () => ({ useMeetings: () => ({ meetings: [] }) }))
vi.mock('@/lib/hooks/useRiskForecast', () => ({ useRiskForecast: () => ({ forecasts: new Map() }) }))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [{ id: 'user-sato', displayName: '佐藤', avatarUrl: null, role: 'editor' }],
    getMemberName: (id: string) => (id === 'user-sato' ? '佐藤' : '不明'),
    isPending: mocks.membersPending,
  }),
}))
vi.mock('@/lib/hooks/useRecentTaskComments', () => ({
  useRecentTaskComments: (_spaceId: string, options: { enabled: boolean }) => {
    mocks.recentCommentsEnabled.push(options.enabled)
    return { comments: options.enabled ? mocks.recentComments : [], loading: false, error: null }
  },
}))
vi.mock('@/lib/hooks/useSpaceActivity', () => ({
  useSpaceActivity: (_spaceId: string, options: { enabled: boolean }) => {
    mocks.activityEnabled.push(options.enabled)
    return {
      rows: options.enabled ? mocks.activityRows : [],
      loading: false,
      error: options.enabled ? mocks.activityError : null,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    }
  },
}))
vi.mock('@/lib/hooks/useSpecDecisionEvents', () => ({
  useSpecDecisionEvents: (_spaceId: string, options: { enabled: boolean }) => {
    mocks.decisionEventsEnabled.push(options.enabled)
    return { events: options.enabled ? mocks.decisionEvents : [], loading: false, error: null }
  },
}))
vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

function renderPage() {
  return render(<DashboardClient orgId="org-1" spaceId="space-1" />)
}

beforeEach(() => {
  // 日本時間 2026-09-16 の昼。Date だけを固定する（イベントの発火は実時間のまま）
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00:00+09:00'))
  localStorage.clear()
  mocks.tasks = []
  mocks.reviewStatuses = {}
  mocks.recentComments = []
  mocks.recentCommentsEnabled = []
  mocks.membersPending = false
  mocks.decisionEvents = []
  mocks.decisionEventsEnabled = []
  mocks.activityRows = []
  mocks.activityEnabled = []
  mocks.activityError = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardClient — 期限切れ', () => {
  it('承認待ち・クライアント確認待ち・タスクに分けて、過ぎた日数とタスクへのリンクを出す', () => {
    mocks.tasks = [
      task({ id: 'r1', title: '見積の社内承認', status: 'in_review', due_date: '2026-09-14' }),
      task({ id: 'c1', title: 'デザイン案の確認', ball: 'client', due_date: '2026-09-10' }),
      task({ id: 't1', title: '請求書を作る', due_date: '2026-09-15' }),
      task({ id: 'today', title: '今日が期限', due_date: '2026-09-16' }),
    ]
    renderPage()

    const section = screen.getByRole('region', { name: '期限切れ' })
    expect(within(section).getByText('承認待ち')).toBeInTheDocument()
    expect(within(section).getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(within(section).getByText('タスク')).toBeInTheDocument()

    const link = within(section).getByRole('link', { name: /デザイン案の確認/ })
    expect(link).toHaveAttribute('href', '/org-1/project/space-1?task=c1')
    expect(link).toHaveTextContent('6日超過')

    // 今日が期限のものは、まだ期限切れではない
    expect(within(section).queryByText('今日が期限')).not.toBeInTheDocument()
  })

  it('上の数字の「期限超過」も、同じ数え方（日本時間の今日より前）にそろえる', () => {
    mocks.tasks = [
      task({ id: 't1', due_date: '2026-09-15' }),
      task({ id: 'today', due_date: '2026-09-16' }),
    ]
    renderPage()
    const kpi = screen.getByText('期限超過').parentElement!
    expect(kpi).toHaveTextContent('1')
  })

  it('承認依頼の状態はタスク一覧と同じ元から見る。状態が古いままの依頼も承認待ちに入る', () => {
    // 承認依頼の一覧（useReviews）は新しい50件しか読まないので、古い依頼はそこに無いことがある。
    // ダッシュボードは useReviews を使わず、タスク一覧と一緒に読む reviewStatuses を見る
    mocks.reviewStatuses = { legacy: 'open', approved: 'approved' }
    mocks.tasks = [
      task({ id: 'legacy', title: '古い依頼のタスク', status: 'in_progress', due_date: '2026-09-01' }),
      task({ id: 'approved', title: '承認済みのタスク', status: 'in_progress', due_date: '2026-09-01' }),
    ]
    renderPage()

    const section = screen.getByRole('region', { name: '期限切れ' })
    const reviewLabel = within(section).getByText('承認待ち')
    const reviewGroup = reviewLabel.closest('div')!
    expect(within(reviewGroup).getByRole('link', { name: /古い依頼のタスク/ })).toBeInTheDocument()
    expect(within(reviewGroup).queryByRole('link', { name: /承認済みのタスク/ })).not.toBeInTheDocument()

    // 上の「レビュー待ち」も同じ元から数える
    expect(screen.getByText('レビュー待ち').parentElement).toHaveTextContent('1')
  })

  it('期限切れが無ければ、そう書く', () => {
    renderPage()
    const section = screen.getByRole('region', { name: '期限切れ' })
    expect(within(section).getByText('期限切れのものはありません')).toBeInTheDocument()
  })
})

describe('DashboardClient — 本番・CI（UTC）で動いても、日本時間の今日で判定する', () => {
  const originalTz = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'UTC'
  })
  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('日本時間の朝7時（UTC ではまだ前日）でも、昨日が期限のタスクは期限切れになる', () => {
    vi.setSystemTime(new Date('2026-09-16T07:00:00+09:00'))
    mocks.tasks = [task({ id: 'y', title: '昨日までの作業', due_date: '2026-09-15' })]
    renderPage()
    const section = screen.getByRole('region', { name: '期限切れ' })
    expect(within(section).getByRole('link', { name: /昨日までの作業/ })).toHaveTextContent('1日超過')
  })
})

describe('DashboardClient — 前からある項目の日付も、期限切れと同じ数え方にする', () => {
  // 日本時間の昼（UTC では同じ日の3時）。前の数え方（new Date(due_date) と今の時刻の差）だと、
  // 期限が今日のタスクは朝9時を過ぎた時点で「1日超過」、明日のタスクは「今日」になっていた
  it('期限が近いタスク: 今日が期限なら「今日」、明日なら「1日後」', () => {
    mocks.tasks = [
      task({ id: 'd0', title: '見積書の送付', due_date: '2026-09-16' }),
      task({ id: 'd1', title: '請求書の確認', due_date: '2026-09-17' }),
    ]
    renderPage()
    const section = screen.getByRole('heading', { name: '期限が近いタスク' }).parentElement!
    const todayLink = within(section).getByRole('link', { name: /見積書の送付/ })
    expect(todayLink).toHaveTextContent('今日')
    expect(todayLink).not.toHaveTextContent('超過')
    expect(within(section).getByRole('link', { name: /請求書の確認/ })).toHaveTextContent('1日後')
  })

  it('クライアント確認が必要: 今日が期限のものは「要フォロー（期限超過）」に入れない', () => {
    mocks.tasks = [task({ id: 'c0', title: '原稿の確認', ball: 'client', due_date: '2026-09-16' })]
    renderPage()
    const section = screen.getByRole('heading', { name: /クライアント確認が必要/ }).parentElement!
    expect(within(section).queryByText('要フォロー')).not.toBeInTheDocument()
    expect(within(section).getByText('そろそろ確認')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /原稿の確認/ })).toHaveTextContent('今日')
  })
})

describe('DashboardClient — 確定事項', () => {
  it('決まったことを新しい順に出し、状態と決まった日を添える。押すとそのタスクが開く', () => {
    mocks.tasks = [
      task({ id: 'd1', title: '見積の出し方', type: 'spec', decision_state: 'decided' }),
      task({ id: 'd2', title: '納品の形式', type: 'spec', decision_state: 'implemented' }),
    ]
    mocks.decisionEvents = [
      { task_id: 'd1', action: 'SPEC_DECIDE', created_at: '2026-09-10T03:00:00Z' },
      { task_id: 'd2', action: 'SPEC_IMPLEMENT', created_at: '2026-09-14T03:00:00Z' },
    ]
    renderPage()

    const section = screen.getByRole('region', { name: '確定事項' })
    const links = within(section).getAllByRole('link')
    expect(links[0]).toHaveTextContent('納品の形式')
    expect(links[0]).toHaveTextContent('実装済み')
    expect(links[0]).toHaveTextContent('9/14')
    expect(links[0]).toHaveAttribute('href', '/org-1/project/space-1?task=d2')
    expect(links[1]).toHaveTextContent('見積の出し方')
    expect(links[1]).toHaveTextContent('決定済み')
  })

  it('見出しに「確定 1/2」でどこまで決まったかを出す', () => {
    mocks.tasks = [
      task({ id: 'd1', title: '見積の出し方', type: 'spec', decision_state: 'decided' }),
      task({ id: 'c1', title: '保守の範囲', type: 'spec', decision_state: 'considering' }),
    ]
    renderPage()

    const section = screen.getByRole('region', { name: '確定事項' })
    expect(within(section).getByTestId('dashboard-decision-progress')).toHaveTextContent('確定 1/2')
  })

  it('全部決まったら「確定 2/2」になる', () => {
    mocks.tasks = [
      task({ id: 'd1', type: 'spec', decision_state: 'decided' }),
      task({ id: 'd2', type: 'spec', decision_state: 'implemented' }),
    ]
    renderPage()
    expect(screen.getByTestId('dashboard-decision-progress')).toHaveTextContent('確定 2/2')
  })

  it('決定事項のタスクが無ければ、進み具合は出さない', () => {
    mocks.tasks = [task({ id: 'plain', title: 'ふつうのタスク' })]
    renderPage()
    expect(screen.queryByTestId('dashboard-decision-progress')).not.toBeInTheDocument()
  })

  it('まだ決まっていないもの（検討中）は「検討中」として別に出す', () => {
    mocks.tasks = [
      task({ id: 'c1', title: '保守の範囲', type: 'spec', decision_state: 'considering' }),
      task({ id: 'plain', title: 'ふつうのタスク' }),
    ]
    renderPage()

    const section = screen.getByRole('region', { name: '確定事項' })
    expect(within(section).getByText('検討中')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /保守の範囲/ })).toBeInTheDocument()
    expect(within(section).queryByText('決まったこと')).not.toBeInTheDocument()
    expect(within(section).queryByText('ふつうのタスク')).not.toBeInTheDocument()
  })

  it('決定事項のタスクが無ければ、そう書く', () => {
    mocks.tasks = [task({ id: 'plain', title: 'ふつうのタスク' })]
    renderPage()
    const section = screen.getByRole('region', { name: '確定事項' })
    expect(within(section).getByText('まだ決まったことはありません')).toBeInTheDocument()
  })

  it('決まった日の記録がまだ届いていなくても、一覧は出す（日付だけ後から付く）', () => {
    mocks.tasks = [task({ id: 'd1', title: '見積の出し方', type: 'spec', decision_state: 'decided' })]
    renderPage()
    const section = screen.getByRole('region', { name: '確定事項' })
    expect(within(section).getByRole('link', { name: /見積の出し方/ })).toBeInTheDocument()
  })

  it('「確定事項」を外しているあいだは、決めたときの記録を読みに行かない', () => {
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify({ hidden: ['decisions'] }))
    renderPage()
    expect(screen.queryByRole('region', { name: '確定事項' })).not.toBeInTheDocument()
    expect(mocks.decisionEventsEnabled.length).toBeGreaterThan(0)
    expect(mocks.decisionEventsEnabled.every((enabled) => enabled === false)).toBe(true)
  })
})

describe('DashboardClient — 最近のコメント', () => {
  it('タスク名・書いた人・本文・いつ書いたかを出し、押すとタスクが開く', () => {
    mocks.tasks = [task({ id: 'task-a', title: 'ロゴの修正' })]
    mocks.recentComments = [
      {
        id: 'c1',
        task_id: 'task-a',
        actor_id: 'user-sato',
        body: '2案目で進めてください',
        created_at: '2026-09-16T09:00:00+09:00',
      },
    ]
    renderPage()

    const section = screen.getByRole('region', { name: '最近のコメント' })
    const link = within(section).getByRole('link', { name: /ロゴの修正/ })
    expect(link).toHaveAttribute('href', '/org-1/project/space-1?task=task-a')
    expect(link).toHaveTextContent('佐藤')
    expect(link).toHaveTextContent('2案目で進めてください')
    expect(link).toHaveTextContent('3時間前')
  })

  it('書いた人の名前がまだ届いていないあいだは、IDの切れ端を出さずに「読み込み中」にする', () => {
    mocks.membersPending = true
    mocks.tasks = [task({ id: 'task-a', title: 'ロゴの修正' })]
    mocks.recentComments = [
      { id: 'c1', task_id: 'task-a', actor_id: 'user-sato', body: '本文', created_at: '2026-09-16T09:00:00+09:00' },
    ]
    renderPage()
    const section = screen.getByRole('region', { name: '最近のコメント' })
    expect(within(section).getByText('読み込み中…')).toBeInTheDocument()
    expect(within(section).queryByRole('link')).not.toBeInTheDocument()
  })

  it('名簿にいない人（プロジェクトから外れた人など）は、IDの切れ端ではなくコメント欄と同じ言葉で出す', () => {
    mocks.tasks = [task({ id: 'task-a', title: 'ロゴの修正' })]
    mocks.recentComments = [
      { id: 'c1', task_id: 'task-a', actor_id: 'user-ghost-0001', body: '本文', created_at: '2026-09-16T09:00:00+09:00' },
    ]
    renderPage()
    const link = within(screen.getByRole('region', { name: '最近のコメント' })).getByRole('link', { name: /ロゴの修正/ })
    expect(link).toHaveTextContent('（メンバー外）')
    expect(link).not.toHaveTextContent('user-gho')
  })

  it('一覧にないタスク（消したタスクなど）のコメントは出さない', () => {
    mocks.recentComments = [
      { id: 'c1', task_id: 'gone', actor_id: 'user-sato', body: '消えたタスク', created_at: '2026-09-16T09:00:00+09:00' },
    ]
    renderPage()
    const section = screen.getByRole('region', { name: '最近のコメント' })
    expect(within(section).queryByText('消えたタスク')).not.toBeInTheDocument()
    expect(within(section).getByText('まだコメントはありません')).toBeInTheDocument()
  })
})

describe('DashboardClient — 表示する項目を選ぶ', () => {
  it('メニューで外した項目は消え、ブラウザに残る', () => {
    renderPage()
    expect(screen.getByText('ボール所在')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '表示する項目' }))
    const item = screen.getByRole('menuitemcheckbox', { name: 'ボール所在' })
    expect(item).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(item)
    expect(screen.getByRole('menuitemcheckbox', { name: 'ボール所在' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('heading', { name: 'ボール所在' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}')).toEqual({ hidden: ['ball'] })
  })

  it('「最近のコメント」を外しているあいだは、コメントを読みに行かない', () => {
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify({ hidden: ['recent_comments'] }))
    renderPage()
    expect(screen.queryByRole('region', { name: '最近のコメント' })).not.toBeInTheDocument()
    // 空の配列だと every は必ず true になるので、呼ばれたことも確かめる
    expect(mocks.recentCommentsEnabled.length).toBeGreaterThan(0)
    expect(mocks.recentCommentsEnabled.every((enabled) => enabled === false)).toBe(true)
  })

  it('全部外したら、選び方を案内する', () => {
    localStorage.setItem(
      DASHBOARD_WIDGET_PREFS_KEY,
      JSON.stringify({ hidden: DASHBOARD_WIDGETS.map((w) => w.id) })
    )
    renderPage()
    expect(screen.getByText(/右上の「表示する項目」から選んでください/)).toBeInTheDocument()
  })

  it('Escape でメニューが閉じる', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '表示する項目' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    // 閉じたら押したボタンに戻す（キーボードで操作している人が位置を見失わないように）
    expect(screen.getByRole('button', { name: '表示する項目' })).toHaveFocus()
  })
})

describe('DashboardClient — 上の数字からタスク一覧へ飛ぶ', () => {
  const base = '/org-1/project/space-1'
  const card = (label: string) => screen.getByText(label).closest('div')!

  it('アクティブ・期限超過・レビュー待ちは、同じ絞り込みをかけたタスク一覧へ飛ぶ', () => {
    mocks.tasks = [
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', status: 'backlog' }),
      task({ id: 'late', due_date: '2026-09-15' }),
      task({ id: 'rv', status: 'in_review' }),
      task({ id: 'd', status: 'done' }),
    ]
    renderPage()

    // 「アクティブ」はタスク一覧の既定と同じ数え方（未着手・完了を除く）
    expect(screen.getByRole('link', { name: /アクティブ/ })).toHaveAttribute('href', base)
    expect(card('アクティブ')).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: /期限超過/ })).toHaveAttribute('href', `${base}?filter=overdue`)
    expect(screen.getByRole('link', { name: /レビュー待ち/ })).toHaveAttribute('href', `${base}?filter=in_review`)
  })

  it('ボールのクライアント側の数字は「クライアント確認待ち」へ飛ぶ', () => {
    mocks.tasks = [task({ id: 'c', ball: 'client' }), task({ id: 'i' })]
    renderPage()
    expect(screen.getByRole('link', { name: 'クライアント 1件' })).toHaveAttribute('href', `${base}?filter=client_wait`)
  })

  it('レビュー待ちは、状態が確認待ちのものと返事待ちの承認依頼があるものを数える（完了は数えない）', () => {
    mocks.tasks = [
      task({ id: 'rv', status: 'in_review' }),
      task({ id: 'open', status: 'in_progress' }),
      task({ id: 'done', status: 'done' }),
    ]
    mocks.reviewStatuses = { open: 'open', done: 'open' }
    renderPage()
    expect(card('レビュー待ち')).toHaveTextContent('2')
  })
})

describe('DashboardClient — ボールの数字だけを隠す', () => {
  it('メニューで「ボール（件数のまとめ）」を外すと、上の数字からボールだけが消える', () => {
    renderPage()
    expect(screen.getByText('ボール (社内/クライアント)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '表示する項目' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'ボール（件数のまとめ）' }))

    expect(screen.queryByText('ボール (社内/クライアント)')).not.toBeInTheDocument()
    expect(screen.getByText('期限超過')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}')).toEqual({ hidden: ['kpi_ball'] })
  })
})

describe('DashboardClient — 期限切れに担当者を出す', () => {
  it('担当者の名前を出し、担当者がいなければ「担当なし」と出す', () => {
    mocks.tasks = [
      task({ id: 'mine', title: '見積の作成', due_date: '2026-09-15', assignee_id: 'user-sato' }),
      task({ id: 'nobody', title: '請求書の送付', due_date: '2026-09-14' }),
    ]
    renderPage()
    const section = screen.getByRole('region', { name: '期限切れ' })
    expect(within(section).getByRole('link', { name: /見積の作成/ })).toHaveTextContent('佐藤')
    expect(within(section).getByRole('link', { name: /請求書の送付/ })).toHaveTextContent('担当なし')
  })
})

function activityRow(overrides: Partial<ActivityRow>): ActivityRow {
  return {
    id: 1,
    occurred_at: '2026-09-16T09:00:00+09:00',
    actor_user_id: 'user-sato',
    channel: 'app',
    kind: 'task_created',
    target_id: 'task-a',
    task_id: 'task-a',
    title: 'ロゴの修正',
    detail: null,
    ...overrides,
  }
}

describe('DashboardClient — 最近のアクティビティ', () => {
  it('誰が・何をした・対象・いつを出し、対象を押すとタスクが開く', () => {
    mocks.activityRows = [activityRow({ kind: 'task_status', detail: { from: 'todo', to: 'in_progress' } })]
    renderPage()

    const section = screen.getByRole('region', { name: '最近のアクティビティ' })
    const item = within(section).getByRole('listitem')
    expect(item).toHaveTextContent('佐藤')
    expect(item).toHaveTextContent('状態を着手予定→進行中に変更')
    expect(item).toHaveTextContent('3時間前')
    expect(within(item).getByRole('link', { name: 'ロゴの修正' })).toHaveAttribute(
      'href',
      '/org-1/project/space-1?task=task-a'
    )
  })

  it('名簿にいない人は（メンバー外）、CLI 経由には CLI のラベル', () => {
    mocks.activityRows = [activityRow({ actor_user_id: 'user-ghost', channel: 'cli' })]
    renderPage()
    const item = within(screen.getByRole('region', { name: '最近のアクティビティ' })).getByRole('listitem')
    expect(item).toHaveTextContent('（メンバー外）')
    expect(item).toHaveTextContent('CLI')
  })

  it('名簿がまだ届いていないあいだは、読み込み中にする', () => {
    mocks.membersPending = true
    mocks.activityRows = [activityRow({})]
    renderPage()
    const section = screen.getByRole('region', { name: '最近のアクティビティ' })
    expect(within(section).getByText('読み込み中…')).toBeInTheDocument()
    expect(within(section).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('権限が無いときは、社内メンバーだけが見られると出す', () => {
    mocks.activityError = { message: 'Not authorized' }
    renderPage()
    expect(screen.getByText(/社内メンバーだけが見られます/)).toBeInTheDocument()
  })

  it('「最近のアクティビティ」を外しているあいだは、記録を読みに行かない', () => {
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify({ hidden: ['activity'] }))
    renderPage()
    expect(screen.queryByRole('region', { name: '最近のアクティビティ' })).not.toBeInTheDocument()
    expect(mocks.activityEnabled.length).toBeGreaterThan(0)
    expect(mocks.activityEnabled.every((enabled) => enabled === false)).toBe(true)
  })

  it('メニューにも「最近のアクティビティ」が出て、外せる', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '表示する項目' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '最近のアクティビティ' }))
    expect(screen.queryByRole('region', { name: '最近のアクティビティ' })).not.toBeInTheDocument()
  })
})

/** 画面に出ている項目の順（data-testid="dashboard-widget-<id>" の並び） */
function widgetOrderOnScreen(): string[] {
  return screen
    .getAllByTestId(/^dashboard-widget-(?!handle-)/)
    .map((el) => el.getAttribute('data-testid')!.replace('dashboard-widget-', ''))
}

describe('DashboardClient — 項目の並び替え', () => {
  it('はじめは既定の順。最近のアクティビティは最近のコメントの次', () => {
    renderPage()
    const order = widgetOrderOnScreen()
    expect(order).toEqual([
      'kpi',
      'overdue',
      'decisions',
      'recent_comments',
      'activity',
      'client_follow_up',
      'milestones',
      'ball',
      'upcoming_deadlines',
      'meetings',
    ])
  })

  it('保存した並び順で描く', () => {
    localStorage.setItem(
      DASHBOARD_WIDGET_PREFS_KEY,
      JSON.stringify({ hidden: [], order: ['meetings', 'kpi', 'overdue'] })
    )
    renderPage()
    expect(widgetOrderOnScreen().slice(0, 3)).toEqual(['meetings', 'kpi', 'overdue'])
  })

  it('メニューの「下へ」で、画面の順が変わりブラウザに残る', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '表示する項目' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '期限切れを下へ' }))
    expect(widgetOrderOnScreen().slice(0, 3)).toEqual(['kpi', 'decisions', 'overdue'])
    expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}').order.slice(0, 3)).toEqual([
      'kpi',
      'decisions',
      'overdue',
    ])
  })

  it('半幅の項目が続いた区間だけ2列の格子になる。間に別の項目があれば別の格子', () => {
    // マイルストーン・ボール所在 | 期限切れ | 期限が近いタスク・直近の予定
    localStorage.setItem(
      DASHBOARD_WIDGET_PREFS_KEY,
      JSON.stringify({ hidden: [], order: ['milestones', 'ball', 'overdue', 'upcoming_deadlines', 'meetings'] })
    )
    renderPage()
    const gridOf = (id: string) => screen.getByTestId(`dashboard-widget-${id}`).parentElement!
    expect(gridOf('milestones')).toBe(gridOf('ball'))
    expect(gridOf('upcoming_deadlines')).toBe(gridOf('meetings'))
    expect(gridOf('milestones')).not.toBe(gridOf('meetings'))
    expect(gridOf('milestones').className).toContain('lg:grid-cols-2')
    // 全幅の項目は格子に入らない
    expect(gridOf('overdue').className).not.toContain('grid-cols-2')
  })

  it('つかみを持って別の項目の上に落とすと、その項目の前に移る', () => {
    renderPage()
    const handle = screen.getByTestId('dashboard-widget-handle-meetings')
    fireEvent.dragStart(handle)
    const target = screen.getByTestId('dashboard-widget-overdue')
    fireEvent.dragOver(target)
    expect(target).toHaveAttribute('data-drop-target', 'true')
    fireEvent.drop(target)

    expect(widgetOrderOnScreen().slice(0, 3)).toEqual(['kpi', 'meetings', 'overdue'])
    // 落としたら、ドラッグ中・落とし先の見た目は消える
    expect(screen.getByTestId('dashboard-widget-overdue')).not.toHaveAttribute('data-drop-target')
    expect(screen.getByTestId('dashboard-widget-meetings')).not.toHaveAttribute('data-dragging')
    expect(JSON.parse(localStorage.getItem(DASHBOARD_WIDGET_PREFS_KEY) ?? '{}').order.slice(0, 3)).toEqual([
      'kpi',
      'meetings',
      'overdue',
    ])
  })

  it('途中でやめたら（dragend）、並び順は変わらない', () => {
    renderPage()
    const handle = screen.getByTestId('dashboard-widget-handle-meetings')
    fireEvent.dragStart(handle)
    expect(screen.getByTestId('dashboard-widget-meetings')).toHaveAttribute('data-dragging', 'true')
    fireEvent.dragOver(screen.getByTestId('dashboard-widget-overdue'))
    fireEvent.dragEnd(handle)
    expect(widgetOrderOnScreen()[1]).toBe('overdue')
    expect(screen.getByTestId('dashboard-widget-meetings')).not.toHaveAttribute('data-dragging')
  })

  it('隠した項目は枠も出さない。つかみはスマホ（md 未満）では出ない作り（hidden md:flex）', () => {
    localStorage.setItem(DASHBOARD_WIDGET_PREFS_KEY, JSON.stringify({ hidden: ['ball'] }))
    renderPage()
    expect(screen.queryByTestId('dashboard-widget-ball')).not.toBeInTheDocument()
    const handle = screen.getByTestId('dashboard-widget-handle-overdue')
    expect(handle.className).toMatch(/\bhidden\b/)
    expect(handle.className).toMatch(/\bmd:flex\b/)
  })
})
