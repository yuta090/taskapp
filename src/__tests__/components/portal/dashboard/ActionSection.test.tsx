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

/**
 * B5: with zero action tasks, the waitingMessage banner, the built-in
 * "全て完了しています" heading, and "あなたの確認が必要なタスクはありません。"
 * all rendered at once — three overlapping empty-state messages.
 */
describe('ActionSection — empty state message (B5)', () => {
  it('renders a single empty-state message using the waitingMessage text, not a duplicated banner', () => {
    render(
      <ActionSection
        tasks={[]}
        totalCount={0}
        waitingMessage="すべてのタスクが確認済みです"
      />
    )

    expect(screen.getByText('すべてのタスクが確認済みです')).toBeInTheDocument()
    expect(screen.queryByText('全て完了しています')).not.toBeInTheDocument()
    expect(screen.queryByText('あなたの確認が必要なタスクはありません。')).not.toBeInTheDocument()
  })

  it('falls back to a single "すべて" worded message when no waitingMessage is provided', () => {
    render(<ActionSection tasks={[]} totalCount={0} />)

    expect(screen.getByText(/すべて/)).toBeInTheDocument()
    expect(screen.queryByText('全て完了しています')).not.toBeInTheDocument()
  })
})
