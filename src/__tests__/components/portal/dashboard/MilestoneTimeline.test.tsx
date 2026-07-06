import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MilestoneTimeline } from '@/components/portal/dashboard/MilestoneTimeline'

/**
 * B6: the due date was only revealed on hover (opacity-0 group-hover:opacity-100),
 * so it never appeared on touch devices. The "NOW" badge also exposed an
 * English word in an otherwise Japanese client-facing surface.
 */
describe('MilestoneTimeline — due date always visible (B6)', () => {
  it('renders the due date without hover-only opacity classes', () => {
    render(
      <MilestoneTimeline
        milestones={[{ id: 'm1', name: 'フェーズ1', status: 'current', dueDate: '2026-08-01' }]}
      />
    )

    const dateEl = screen.getByText('8/1')
    expect(dateEl.className).not.toMatch(/opacity-0/)
  })

  it('shows 現在 instead of the English "NOW" badge for the current milestone', () => {
    render(
      <MilestoneTimeline
        milestones={[{ id: 'm1', name: 'フェーズ1', status: 'current', dueDate: null }]}
      />
    )

    expect(screen.getByText('現在')).toBeInTheDocument()
    expect(screen.queryByText('NOW')).not.toBeInTheDocument()
  })
})
