import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConsideringDecisionPanel } from '@/components/task/ConsideringDecisionPanel'

// Mock the hook so the panel drives a fake decideConsidering
const mockDecide = vi.fn()
vi.mock('@/lib/hooks/useConsidering', () => ({
  useConsidering: () => ({
    consideringTasks: [],
    loading: false,
    error: null,
    fetchConsidering: vi.fn(),
    decideConsidering: mockDecide,
  }),
}))

const clientMembers = [
  { id: 'c1', displayName: '鈴木（クライアント）' },
  { id: 'c2', displayName: '高橋（クライアント）' },
]

function renderPanel(onDecided = vi.fn()) {
  return render(
    <ConsideringDecisionPanel
      taskId="t1"
      spaceId="s1"
      clientMembers={clientMembers}
      onDecided={onDecided}
    />
  )
}

describe('ConsideringDecisionPanel (AT-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecide.mockResolvedValue(undefined)
  })

  it('disables submit until 決定内容 and 確認相手 are both provided', () => {
    renderPanel()
    const submit = screen.getByTestId('considering-submit') as HTMLButtonElement

    // initially disabled
    expect(submit.disabled).toBe(true)

    // only decision text → still disabled
    fireEvent.change(screen.getByTestId('considering-decision-text'), {
      target: { value: 'A案で確定' },
    })
    expect(submit.disabled).toBe(true)

    // add 確認相手 → enabled
    fireEvent.change(screen.getByTestId('considering-confirmed-by'), {
      target: { value: 'c1' },
    })
    expect(submit.disabled).toBe(false)
  })

  it('records the decision on behalf of the client with the chosen evidence', async () => {
    const onDecided = vi.fn()
    renderPanel(onDecided)

    fireEvent.change(screen.getByTestId('considering-decision-text'), {
      target: { value: 'メールで合意' },
    })
    fireEvent.change(screen.getByTestId('considering-evidence'), {
      target: { value: 'email' },
    })
    fireEvent.change(screen.getByTestId('considering-confirmed-by'), {
      target: { value: 'c2' },
    })
    fireEvent.click(screen.getByTestId('considering-submit'))

    await waitFor(() => expect(mockDecide).toHaveBeenCalledTimes(1))
    expect(mockDecide).toHaveBeenCalledWith({
      taskId: 't1',
      decisionText: 'メールで合意',
      onBehalfOf: 'client',
      evidence: 'email',
      clientConfirmedBy: 'c2',
    })
    await waitFor(() => expect(onDecided).toHaveBeenCalled())
  })

  it('does not offer "meeting" as an out-of-meeting evidence option', () => {
    renderPanel()
    const evidence = screen.getByTestId('considering-evidence')
    const values = Array.from(evidence.querySelectorAll('option')).map((o) => o.getAttribute('value'))
    expect(values).not.toContain('meeting')
    expect(values).toContain('email')
  })
})
