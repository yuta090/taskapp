import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InternalOnboardingWalkthrough } from '@/components/onboarding/InternalOnboardingWalkthrough'

const mockMarkDone = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/useOnboardingFlag', () => ({
  useOnboardingFlag: () => ({ shouldShow: true, markDone: mockMarkDone }),
}))

// Step 2 ("ボールの概念") targets `[data-walkthrough="task-row-ball"]` in the
// live app (see src/components/task/TaskRow.tsx). These tests render that
// target element alongside the walkthrough to control whether it exists.
function renderWithTarget() {
  return render(
    <>
      <div data-walkthrough="task-row-ball">ball badge</div>
      <InternalOnboardingWalkthrough />
    </>
  )
}

describe('InternalOnboardingWalkthrough spotlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a centered dialog (no spotlight) for a step without targetSelector', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('walkthrough-spotlight-ring')).not.toBeInTheDocument()
  })

  it('falls back to the centered dialog when targetSelector matches no element (regression guard)', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    // Step 0 -> Step 1 ("ボールの概念"), whose target does not exist in this render tree
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('walkthrough-spotlight-ring')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders a spotlight ring around the target element when it exists', async () => {
    renderWithTarget()

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
    })

    expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
  })

  it('calls markDone (server + localStorage) when the walkthrough is completed', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('ボールの概念'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('クライアントに公開'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('準備完了！'))
    fireEvent.click(screen.getByText('始めましょう'))

    await waitFor(() => {
      expect(mockMarkDone).toHaveBeenCalledTimes(1)
    })
  })
})
