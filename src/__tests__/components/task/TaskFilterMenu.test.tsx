import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskFilterMenu, defaultFilters } from '@/components/task/TaskFilterMenu'

describe('TaskFilterMenu — ステータスラベルの用語統一 (M-3)', () => {
  it('ステータスの選択肢に「着手予定」「社内承認中」を使う', () => {
    render(
      <TaskFilterMenu
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        milestones={[]}
        owners={[]}
      />
    )

    fireEvent.click(screen.getByText('フィルター'))
    fireEvent.click(screen.getByText('ステータス'))

    expect(screen.getByText('着手予定')).toBeInTheDocument()
    expect(screen.getByText('社内承認中')).toBeInTheDocument()
    expect(screen.queryByText('Todo')).not.toBeInTheDocument()
    expect(screen.queryByText('承認確認中')).not.toBeInTheDocument()
  })
})
