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

    fireEvent.click(screen.getByRole('button', { name: '詳細フィルター' }))
    fireEvent.click(screen.getByText('ステータス'))

    expect(screen.getByText('着手予定')).toBeInTheDocument()
    expect(screen.getByText('社内承認中')).toBeInTheDocument()
    expect(screen.queryByText('Todo')).not.toBeInTheDocument()
    expect(screen.queryByText('承認確認中')).not.toBeInTheDocument()
  })
})

describe('TaskFilterMenu — 入口はアイコンだけにする', () => {
  function renderMenu() {
    return render(
      <TaskFilterMenu
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        milestones={[]}
        owners={[]}
      />
    )
  }

  it('ボタンに「フィルター」の文字を出さない（アイコンだけ）', () => {
    renderMenu()
    expect(screen.queryByText('フィルター')).not.toBeInTheDocument()
  })

  it('カーソルを合わせると「詳細フィルター」と出る', () => {
    renderMenu()
    expect(screen.getByRole('button', { name: '詳細フィルター' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('詳細フィルター')
  })

  it('ツールチップはヘッダーで見切れないよう下に出す', () => {
    renderMenu()
    expect(screen.getByRole('tooltip').className).toContain('top-full')
  })
})
