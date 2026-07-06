import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MilestoneGroupHeader } from '@/components/task/MilestoneGroupHeader'
import type { Milestone } from '@/types/database'

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    org_id: 'o1',
    space_id: 's1',
    name: 'フェーズ3: 開発',
    due_date: '2026-02-07',
    completed_at: null,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Milestone
}

/**
 * A4: グループ見出しの期日「2/7」が件数「(3)」と隣接して並ぶと分数のように
 * 見えてしまうため、期日には「期日 」という接頭辞を付けて区別する。
 */
describe('MilestoneGroupHeader — 期日ラベルの明示 (A4)', () => {
  it('期日に「期日 」接頭辞を付けて表示する', () => {
    render(<MilestoneGroupHeader milestone={makeMilestone()} taskCount={3} />)

    expect(screen.getByText('期日 2/7')).toBeInTheDocument()
    expect(screen.queryByText('2/7')).not.toBeInTheDocument()
  })

  it('期日が無いマイルストーンでは期日ラベルを表示しない', () => {
    render(<MilestoneGroupHeader milestone={makeMilestone({ due_date: null })} taskCount={3} />)

    expect(screen.queryByText(/期日/)).not.toBeInTheDocument()
  })
})
