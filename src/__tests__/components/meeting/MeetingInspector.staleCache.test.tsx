import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { MeetingInspector } from '@/components/meeting/MeetingInspector'
import type { Meeting } from '@/types/database'

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [] }),
}))

// HIGH-N3（レビュアーの再現テスト I1 相当）: 一覧のキャッシュが古くなり
// meeting.minutes_md が undefined の行に置き換わると、タスク化ボタンが消え、
// 「もう一度確認」を押してもプレビューが再取得されなかった（本文の有無に頼っていたため）。

const row = {
  id: 'm1',
  org_id: 'o',
  space_id: 's',
  title: 't',
  status: 'ended',
  held_at: null,
  started_at: null,
  ended_at: null,
  created_at: 'c',
  summary_subject: null,
  summary_body: null,
  updated_at: 'U1',
} as unknown as Meeting

function openMinutesTab() {
  fireEvent.click(screen.getByTestId('meeting-inspector-tab-taskify'))
}

describe('HIGH-N3: 一覧のキャッシュが古くなっても、タスク化と「もう一度確認」が働く', () => {
  it('minutes_md が undefined の行に置き換わっても、タスク化ボタンを押すと onCreateTasks を呼ぶ', async () => {
    const preview = vi.fn().mockResolvedValue({
      newSpecCount: 1,
      existingSpecCount: 0,
      newSpecs: [{ lineNumber: 1, specPath: 'a', title: 'b' }],
      existingSpecs: [],
    })
    const create = vi.fn().mockResolvedValue({ createdCount: 1, createdTasks: [], updatedMinutes: '' })

    const { rerender } = render(
      <MeetingInspector
        meeting={{ ...row, minutes_md: '- [ ] SPEC(a): b' }}
        onClose={vi.fn()}
        onPreviewMinutes={preview}
        onCreateTasks={create}
      />
    )
    openMinutesTab()
    const button = await screen.findByTestId('minutes-taskify-button')
    expect(button).toBeInTheDocument()

    // 一覧の再取得(staleTime超過)で minutes_md が undefined の行に置き換わる
    rerender(
      <MeetingInspector
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meeting={{ ...row, minutes_md: undefined as any }}
        onClose={vi.fn()}
        onPreviewMinutes={preview}
        onCreateTasks={create}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('minutes-taskify-button'))
    })
    expect(create).toHaveBeenCalledWith('m1')
  })

  it('minutes_md が undefined の行に置き換わっても、「もう一度確認」でプレビューを取り直せる', async () => {
    const preview = vi.fn().mockResolvedValue({
      newSpecCount: 1,
      existingSpecCount: 0,
      newSpecs: [{ lineNumber: 1, specPath: 'a', title: 'b' }],
      existingSpecs: [],
    })
    const { rerender } = render(
      <MeetingInspector
        meeting={{ ...row, minutes_md: '- [ ] SPEC(a): b' }}
        onClose={vi.fn()}
        onPreviewMinutes={preview}
        onCreateTasks={vi.fn()}
      />
    )
    openMinutesTab()
    await screen.findByTestId('minutes-taskify-button')
    expect(preview).toHaveBeenCalledTimes(1)

    rerender(
      <MeetingInspector
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        meeting={{ ...row, minutes_md: undefined as any }}
        onClose={vi.fn()}
        onPreviewMinutes={preview}
        onCreateTasks={vi.fn()}
      />
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('minutes-task-refresh'))
    })
    expect(preview).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('minutes-taskify-button')).toBeInTheDocument()
  })
})
