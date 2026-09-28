import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { DashboardClient } from '@/app/(internal)/[orgId]/project/[spaceId]/dashboard/DashboardClient'
import type { Task } from '@/types/database'

/**
 * ダッシュボードの「全体／メンバー別／今週」の切り替え。
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
  wikiPages: [] as Array<{ id: string; title: string; created_at: string; updated_at: string }>,
  wikiEnabled: [] as boolean[],
  meetings: [] as Array<{ id: string; title: string; held_at: string | null; status: string }>,
}))

// 本物と同じく、開いたときの URL の ?view= を読む
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
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
vi.mock('@/lib/hooks/useMeetings', () => ({ useMeetings: () => ({ meetings: mocks.meetings }) }))
vi.mock('@/lib/hooks/useWeekWikiActivity', () => ({
  useWeekWikiActivity: (_spaceId: string, _since: string, options: { enabled: boolean }) => {
    mocks.wikiEnabled.push(options.enabled)
    return { pages: options.enabled ? mocks.wikiPages : [], loading: false, error: null }
  },
}))
vi.mock('@/lib/hooks/useRiskForecast', () => ({ useRiskForecast: () => ({ forecasts: new Map() }) }))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [
      { id: 'user-sato', displayName: '佐藤', avatarUrl: null, role: 'editor' },
      { id: 'user-kato', displayName: '加藤', avatarUrl: null, role: 'editor' },
    ],
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
  // 日本時間 2026-09-16(水) の昼
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-16T12:00:00+09:00'))
  localStorage.clear()
  window.history.replaceState(null, '', '/org-1/project/space-1/dashboard')
  mocks.tasks = []
  mocks.reviewStatuses = {}
  mocks.recentComments = []
  mocks.recentCommentsEnabled = []
  mocks.membersPending = false
  mocks.decisionEvents = []
  mocks.decisionEventsEnabled = []
  mocks.wikiPages = []
  mocks.wikiEnabled = []
  mocks.meetings = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DashboardClient — 表示の切り替え', () => {
  it('最初は「全体」。タブを押すと切り替わり、URL の ?view= に残る', () => {
    renderPage()
    expect(screen.getByRole('tab', { name: '全体' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: '期限切れ' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'メンバー別' }))
    expect(screen.getByRole('tab', { name: 'メンバー別' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('region', { name: 'メンバー別の進み具合' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '期限切れ' })).not.toBeInTheDocument()
    expect(window.location.search).toBe('?view=members')

    fireEvent.click(screen.getByRole('tab', { name: '全体' }))
    expect(window.location.search).toBe('')
  })

  it('「今週」を開いていないあいだは、Wiki の動きを読みに行かない', () => {
    renderPage()
    expect(mocks.wikiEnabled.length).toBeGreaterThan(0)
    expect(mocks.wikiEnabled.every((e) => e === false)).toBe(true)
  })
})

describe('DashboardClient — メンバー別', () => {
  it('担当者ごとに状態別の件数と期限切れを出し、押すとその人の残りのタスクが開く', () => {
    mocks.tasks = [
      task({ id: 'a', title: '見積の作成', assignee_id: 'user-sato', status: 'in_progress', due_date: '2026-09-10' }),
      task({ id: 'b', title: 'ロゴの修正', assignee_id: 'user-sato', status: 'in_review' }),
      task({ id: 'c', title: '請求書', assignee_id: 'user-sato', status: 'done' }),
      task({ id: 'd', title: '議事録の清書', assignee_id: 'user-kato', status: 'backlog' }),
      task({ id: 'e', title: '誰かがやる', status: 'todo' }),
    ]
    window.history.replaceState(null, '', '/org-1/project/space-1/dashboard?view=members')
    renderPage()

    const section = screen.getByRole('region', { name: 'メンバー別の進み具合' })
    const sato = within(section).getByRole('button', { name: /佐藤/ })
    expect(sato).toHaveTextContent('進行中 1')
    expect(sato).toHaveTextContent('確認待ち 1')
    expect(sato).toHaveTextContent('完了 1')
    expect(sato).toHaveTextContent('期限切れ 1')
    expect(within(section).getByRole('button', { name: /加藤/ })).toHaveTextContent('未着手 1')
    expect(within(section).getByRole('button', { name: /担当なし/ })).toHaveTextContent('着手予定 1')

    expect(within(section).queryByRole('link', { name: /見積の作成/ })).not.toBeInTheDocument()
    fireEvent.click(sato)
    expect(sato).toHaveAttribute('aria-expanded', 'true')
    expect(within(section).getByRole('link', { name: /見積の作成/ })).toHaveAttribute('href', '/org-1/project/space-1?task=a')
    // 完了したものは並べない
    expect(within(section).queryByRole('link', { name: /請求書/ })).not.toBeInTheDocument()
  })
})

describe('DashboardClient — 今週のハイライト', () => {
  it('今週の数と先週との差を出し、Wiki・会議・完了したタスクの一覧へ飛べる', () => {
    mocks.tasks = [
      task({ id: 'c1', title: '見積の送付', status: 'done', completed_at: '2026-09-15T03:00:00Z', created_at: '2026-09-01T00:00:00Z' } as Partial<Task>),
      task({ id: 'c0', title: '先週の作業', status: 'done', completed_at: '2026-09-09T03:00:00Z', created_at: '2026-09-01T00:00:00Z' } as Partial<Task>),
      task({ id: 'n1', title: '新しい依頼', created_at: '2026-09-16T01:00:00Z' } as Partial<Task>),
    ]
    mocks.wikiPages = [
      { id: 'w1', title: '運用ルール', created_at: '2026-09-15T01:00:00Z', updated_at: '2026-09-15T01:00:00Z' },
      { id: 'w2', title: '用語集', created_at: '2026-08-01T01:00:00Z', updated_at: '2026-09-16T01:00:00Z' },
    ]
    mocks.meetings = [{ id: 'm1', title: '週次定例', held_at: '2026-09-14T01:00:00Z', status: 'ended' }]
    window.history.replaceState(null, '', '/org-1/project/space-1/dashboard?view=week')
    renderPage()

    expect(mocks.wikiEnabled.at(-1)).toBe(true)
    const section = screen.getByRole('region', { name: '今週のハイライト' })
    expect(within(section).getByText('9/14(月)〜9/20(日)')).toBeInTheDocument()

    const completedTile = within(section).getByText('完了したタスク', { selector: 'dt' }).parentElement!
    expect(completedTile).toHaveTextContent('1')
    expect(completedTile).toHaveTextContent('先週 1')

    expect(within(section).getByRole('link', { name: /運用ルール/ })).toHaveAttribute('href', '/org-1/project/space-1/wiki?page=w1')
    expect(within(section).getByRole('link', { name: /用語集/ })).toHaveAttribute('href', '/org-1/project/space-1/wiki?page=w2')
    expect(within(section).getByRole('link', { name: /週次定例/ })).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: /見積の送付/ })).toHaveAttribute('href', '/org-1/project/space-1?task=c1')
    expect(within(section).queryByRole('link', { name: /先週の作業/ })).not.toBeInTheDocument()
  })

  it('日ごとの完了・新規を棒で出し、数は読み上げられる', () => {
    mocks.tasks = [
      task({ id: 'c1', status: 'done', completed_at: '2026-09-15T03:00:00Z', created_at: '2026-09-15T01:00:00Z' } as Partial<Task>),
    ]
    window.history.replaceState(null, '', '/org-1/project/space-1/dashboard?view=week')
    renderPage()
    const chart = screen.getByRole('img', { name: /日ごとの完了と新規/ })
    expect(chart).toBeInTheDocument()
    expect(screen.getByLabelText('9/15(火) 完了 1件・新規 1件')).toBeInTheDocument()
  })
})
