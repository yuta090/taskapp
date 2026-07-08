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

describe('PortalTaskInspector — status label completeness (B1)', () => {
  it('shows バックログ for status backlog instead of the raw English value', () => {
    render(<PortalTaskInspector task={{ ...baseTask, status: 'backlog' }} onClose={() => {}} />)

    expect(screen.getByText('バックログ')).toBeInTheDocument()
    expect(screen.queryByText('backlog')).not.toBeInTheDocument()
  })

  it('shows 社内確認中 for status in_review instead of the raw English value', () => {
    render(<PortalTaskInspector task={{ ...baseTask, status: 'in_review' }} onClose={() => {}} />)

    expect(screen.getByText('社内確認中')).toBeInTheDocument()
    expect(screen.queryByText('in_review')).not.toBeInTheDocument()
  })
})

describe('PortalTaskInspector — readOnly (portal preview mode)', () => {
  it('replaces the approve/request-changes buttons with a "プレビューでは操作できません" note', () => {
    render(
      <PortalTaskInspector
        task={{ ...baseTask, status: 'considering' }}
        onClose={() => {}}
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
        readOnly
      />
    )

    expect(screen.getByText('プレビューでは操作できません')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修正依頼' })).not.toBeInTheDocument()
  })

  it('shows nothing extra when readOnly and there are no actions to hide', () => {
    render(<PortalTaskInspector task={baseTask} onClose={() => {}} readOnly />)

    expect(screen.queryByText('プレビューでは操作できません')).not.toBeInTheDocument()
  })

  it('still shows the real action buttons when readOnly is not set (default/unaffected)', () => {
    render(
      <PortalTaskInspector
        task={{ ...baseTask, status: 'considering' }}
        onClose={() => {}}
        onApprove={async () => {}}
        onRequestChanges={async () => {}}
      />
    )

    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
    expect(screen.queryByText('プレビューでは操作できません')).not.toBeInTheDocument()
  })
})
