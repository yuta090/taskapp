import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActionSection } from '@/components/portal/dashboard/ActionSection'

const tasks = [
  { id: 'task-1', title: 'ロゴのご確認' },
  { id: 'task-2', title: '仕様書のご確認' },
]

describe('ActionSection readOnly', () => {
  it('forwards readOnly to every ActionCard, hiding all 承認/修正依頼 buttons', () => {
    render(
      <ActionSection
        tasks={tasks}
        totalCount={2}
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
        readOnly
      />
    )

    expect(screen.queryAllByRole('button', { name: '承認' })).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: '修正依頼' })).toHaveLength(0)
  })

  it('shows 承認/修正依頼 buttons for each task by default', () => {
    render(
      <ActionSection
        tasks={tasks}
        totalCount={2}
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
      />
    )

    expect(screen.getAllByRole('button', { name: '承認' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: '修正依頼' })).toHaveLength(2)
  })
})
