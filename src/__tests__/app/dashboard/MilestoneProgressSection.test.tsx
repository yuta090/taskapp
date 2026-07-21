import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MilestoneProgressSection } from '@/app/(internal)/[orgId]/project/[spaceId]/dashboard/DashboardClient'
import type { Task, Milestone } from '@/types/database'

function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'ms-1',
    org_id: 'org-1',
    space_id: 'space-1',
    name: 'マイルストーンA',
    start_date: null,
    due_date: '2026-01-01', // far in the past relative to "today" in tests
    order_key: 0,
    completed_at: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'Task',
    description: null,
    status: 'done',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    milestone_id: 'ms-1',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    is_sample: false,
    parent_task_id: null,
    wiki_page_id: null,
    completed_at: '2026-01-01',
    due_authority_connection_id: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  }
}

describe('MilestoneProgressSection risk badge (タスク0件 vs 全完了)', () => {
  it('shows a neutral "タスクなし" badge when the milestone has zero tasks (not "完了")', () => {
    const milestone = makeMilestone()
    render(
      <MilestoneProgressSection
        milestones={[milestone]}
        tasks={[]}
        forecasts={new Map([['ms-1', { level: 'none' }]])}
      />
    )

    expect(screen.getByText('タスクなし')).toBeInTheDocument()
    expect(screen.queryByText('完了')).not.toBeInTheDocument()
  })

  it('still shows "完了" when the milestone has tasks and all of them are done', () => {
    const milestone = makeMilestone()
    render(
      <MilestoneProgressSection
        milestones={[milestone]}
        tasks={[makeTask({ id: 'task-1', status: 'done' })]}
        forecasts={new Map([['ms-1', { level: 'none' }]])}
      />
    )

    expect(screen.getByText('完了')).toBeInTheDocument()
    expect(screen.queryByText('タスクなし')).not.toBeInTheDocument()
  })
})
