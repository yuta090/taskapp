import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BurndownControls } from '@/components/burndown/BurndownControls'
import type { Milestone } from '@/types/database'

const milestones = [
  { id: 'm1', name: 'フェーズ1', start_date: '2026-01-01', due_date: '2026-02-01' },
  { id: 'm2', name: 'フェーズ2', start_date: null, due_date: '2026-03-01' },
] as unknown as Milestone[]

const summary = { remaining: 3, total: 10, startDate: '1/1', endDate: '3/1' }

describe('BurndownControls — モバイル縦積み (PR5)', () => {
  it('マイルストーン選択とサマリを表示し、変更で onSelectMilestone を呼ぶ', () => {
    const onSelect = vi.fn()
    render(
      <BurndownControls
        milestones={milestones}
        selectedMilestoneId=""
        onSelectMilestone={onSelect}
        summary={summary}
      />
    )
    expect(screen.getByRole('option', { name: 'プロジェクト全体' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'フェーズ1' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'm1' } })
    expect(onSelect).toHaveBeenCalledWith('m1')
  })

  it('コンテナはモバイルで縦積み(flex-col)、md以上で横並び(md:flex-row)', () => {
    const { container } = render(
      <BurndownControls milestones={milestones} selectedMilestoneId="" onSelectMilestone={vi.fn()} summary={summary} />
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.className).toMatch(/flex-col/)
    expect(root.className).toMatch(/md:flex-row/)
  })

  it('セレクトはモバイル全幅(w-full md:w-auto)', () => {
    render(
      <BurndownControls milestones={milestones} selectedMilestoneId="" onSelectMilestone={vi.fn()} summary={summary} />
    )
    expect(screen.getByRole('combobox').className).toMatch(/w-full/)
    expect(screen.getByRole('combobox').className).toMatch(/md:w-auto/)
  })
})
