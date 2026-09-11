import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardClient } from '@/app/(internal)/[orgId]/project/[spaceId]/dashboard/DashboardClient'

/**
 * ダッシュボードだけ、読み込み中はヘッダーごと画面を差し替えていた。
 *
 * ヘッダーには目印(data-header-bell)が付いていて、これが有る画面では
 * AppShell の「お知らせベルだけの行」（約44px）が消える。読み込み中に
 * ヘッダーが無いと、その行が出たり消えたりして、データが届いた瞬間に
 * 本文が44px 飛び上がる。読み込み中・エラー中でもヘッダーは出し続ける。
 */

const mocks = vi.hoisted(() => ({
  tasksLoading: false,
  tasksError: null as Error | null,
  msLoading: false,
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: [],
    loading: mocks.tasksLoading,
    error: mocks.tasksError,
    fetchTasks: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: mocks.msLoading }),
}))
vi.mock('@/lib/hooks/useReviews', () => ({ useReviews: () => ({ reviews: [] }) }))
vi.mock('@/lib/hooks/useMeetings', () => ({ useMeetings: () => ({ meetings: [] }) }))
vi.mock('@/lib/hooks/useRiskForecast', () => ({ useRiskForecast: () => ({ forecasts: [] }) }))

// お知らせベルは Supabase/組織コンテキストを引くので、取得層だけ差し替える
vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

function renderPage() {
  return render(<DashboardClient orgId="org-1" spaceId="space-1" />)
}

beforeEach(() => {
  mocks.tasksLoading = false
  mocks.tasksError = null
  mocks.msLoading = false
})

describe('DashboardClient — ヘッダーはいつでも出す', () => {
  it('読み込みが終わっていれば、ヘッダーにベルと目印がある', () => {
    renderPage()
    const bell = screen.getByRole('button', { name: 'お知らせ' })
    expect(bell.closest('[data-header-bell]')).not.toBeNull()
  })

  it('読み込み中でも、ヘッダー（パンくず・ベルの目印）は消えない', () => {
    mocks.tasksLoading = true
    const { container } = renderPage()
    expect(container.querySelector('[data-header-bell]')).not.toBeNull()
    expect(screen.getByText('ダッシュボード')).toBeInTheDocument()
  })

  it('読み込みに失敗したときも、ヘッダーは消えない', () => {
    mocks.tasksError = new Error('boom')
    const { container } = renderPage()
    expect(container.querySelector('[data-header-bell]')).not.toBeNull()
    expect(screen.getByText('データの読み込みに失敗しました')).toBeInTheDocument()
  })
})
