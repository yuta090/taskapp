import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ActivityFeed } from '@/components/portal/dashboard/ActivityFeed'

/**
 * B-3: activity rows were plain text even when the underlying `ball_passed`
 * notification/completed task carried a task_id, so clients had no way to
 * jump to the task from the activity feed.
 */
describe('ActivityFeed', () => {
  it('renders an item with taskId as a link to /portal/task/[taskId]', () => {
    render(
      <ActivityFeed
        activities={[
          {
            id: 'a1',
            type: 'notification',
            message: 'ボールが移動しました',
            timestamp: new Date().toISOString(),
            taskId: 'task-42',
          },
        ]}
      />
    )

    const link = screen.getByRole('link', { name: /ボールが移動しました/ })
    expect(link).toHaveAttribute('href', '/portal/task/task-42')
  })

  it('renders an item without taskId as plain (non-link) text', () => {
    render(
      <ActivityFeed
        activities={[
          {
            id: 'a2',
            type: 'milestone',
            message: 'マイルストーンが更新されました',
            timestamp: new Date().toISOString(),
          },
        ]}
      />
    )

    expect(screen.getByText('マイルストーンが更新されました')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})
