import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TaskReminderField } from '@/components/task/TaskReminderField'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}))

function mockLimits(features: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan_name: 'X', features }) }),
  )
}

describe('TaskReminderField（④ 事前導線）', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('未解禁orgは操作前に「pro以上」導線を出し、入力を無効化する', async () => {
    mockLimits([]) // timed_line_reminders なし
    render(<TaskReminderField taskId="t1" initialRemindAt={null} orgId="org-1" />)
    await waitFor(() => expect(screen.getByText(/pro 以上/)).toBeInTheDocument())
    expect(screen.getByText('プランを見る').closest('a')).toHaveAttribute('href', '/settings/billing')
    expect(screen.getByTestId('task-inspector-remind-at')).toBeDisabled()
  })

  it('解禁orgは導線を出さず入力可能', async () => {
    mockLimits(['timed_line_reminders'])
    render(<TaskReminderField taskId="t1" initialRemindAt={null} orgId="org-1" />)
    await waitFor(() => expect(screen.getByTestId('task-inspector-remind-at')).not.toBeDisabled())
    expect(screen.queryByText(/pro 以上/)).not.toBeInTheDocument()
  })

  it('既存のremind_atがある場合は未解禁でも塞がない（解除できるように）', async () => {
    mockLimits([])
    render(<TaskReminderField taskId="t1" initialRemindAt="2026-07-20T08:00:00.000Z" orgId="org-1" />)
    await waitFor(() => expect(screen.getByTestId('task-inspector-remind-at')).not.toBeDisabled())
    expect(screen.getByText('解除')).toBeInTheDocument()
  })
})
