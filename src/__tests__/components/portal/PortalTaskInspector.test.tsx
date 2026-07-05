import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PortalTaskInspector } from '@/components/portal/PortalTaskInspector'

/**
 * Regression tests for H-4: the portal task detail panel showed only
 * title / created-at / comments, with no way to tell whether a task
 * genuinely has no description or the panel just failed to render it
 * (tasks default to description: '' in the DB, which is falsy and was
 * previously skipped entirely).
 */

const baseTask = {
  id: 'task-1',
  title: 'ロゴのご確認',
}

describe('PortalTaskInspector — description visibility (H-4)', () => {
  it('renders the task description when present', () => {
    render(
      <PortalTaskInspector
        task={{ ...baseTask, description: '新しいロゴ案を3パターンご用意しました。' }}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('新しいロゴ案を3パターンご用意しました。')).toBeInTheDocument()
    expect(screen.queryByText('説明はありません')).not.toBeInTheDocument()
  })

  it('shows an explicit "説明はありません" placeholder when the description is an empty string', () => {
    render(
      <PortalTaskInspector
        task={{ ...baseTask, description: '' }}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('説明はありません')).toBeInTheDocument()
  })

  it('shows the placeholder when description is null', () => {
    render(
      <PortalTaskInspector
        task={{ ...baseTask, description: null }}
        onClose={() => {}}
      />
    )

    expect(screen.getByText('説明はありません')).toBeInTheDocument()
  })

  it('shows the placeholder when description is undefined', () => {
    render(<PortalTaskInspector task={{ ...baseTask }} onClose={() => {}} />)

    expect(screen.getByText('説明はありません')).toBeInTheDocument()
  })

  it('preserves line breaks in the description as plain text', () => {
    render(
      <PortalTaskInspector
        task={{ ...baseTask, description: '1行目\n2行目' }}
        onClose={() => {}}
      />
    )

    const description = screen.getByText((_, element) => element?.textContent === '1行目\n2行目')
    expect(description).toHaveClass('whitespace-pre-wrap')
  })
})
