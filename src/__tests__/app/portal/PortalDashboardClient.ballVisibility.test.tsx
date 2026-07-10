import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalDashboardClient } from '@/app/portal/PortalDashboardClient'

/**
 * #86: ボール所有権と承認履歴は portal/page.tsx で計算・取得済みだが未描画だった。
 * ダッシュボードがそれらを実際に描画することを保証する。
 */

const baseProject = {
  id: 'proj1',
  name: 'サンプルプロジェクト',
  token: 'tok',
}

function buildDashboardData(overrides: Record<string, unknown> = {}) {
  return {
    health: { status: 'on_track' as const, reason: '順調' },
    alert: { overdueCount: 0, nextDueDate: null },
    actionTasks: [],
    totalActionCount: 0,
    progress: { completedCount: 3, totalCount: 10, deadline: null },
    milestones: [],
    ballOwnership: { clientCount: 2, teamCount: 5 },
    currentPhaseProgress: { completedCount: 1, totalCount: 4, phaseName: 'フェーズ1' },
    activities: [],
    approvals: [
      { id: 'a1', taskTitle: 'ロゴ承認', approvedAt: '2026-06-01', comment: 'OKです' },
      { id: 'a2', taskTitle: 'TOP構成', approvedAt: '2026-06-10' },
    ],
    ...overrides,
  }
}

function renderDashboard(data = buildDashboardData()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalDashboardClient
        currentProject={baseProject as never}
        projects={[baseProject] as never}
        dashboardData={data as never}
      />
    </QueryClientProvider>
  )
}

describe('PortalDashboardClient — ボール可視化と承認履歴', () => {
  it('ボール所有権（あなた/先方）を描画する', () => {
    renderDashboard()
    // SplitPill: あなた=clientCount(2) / 先方=teamCount(5)
    expect(screen.getByText('あなた')).toBeInTheDocument()
    expect(screen.getByText('先方')).toBeInTheDocument()
  })

  it('承認履歴ウィジェットを描画する（ナビの同名リンクに加えて）', () => {
    renderDashboard()
    // 「承認履歴」はナビにも存在するため、ウィジェット追加で 2 箇所になる
    expect(screen.getAllByText('承認履歴')).toHaveLength(2)
  })

  it('承認が0件のときは承認履歴ウィジェットを描画しない（ナビのみ）', () => {
    renderDashboard(buildDashboardData({ approvals: [] }))
    // ウィジェットは非表示、ナビの1箇所だけ残る
    expect(screen.getAllByText('承認履歴')).toHaveLength(1)
  })
})
