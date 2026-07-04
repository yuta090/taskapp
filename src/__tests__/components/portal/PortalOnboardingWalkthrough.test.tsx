import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PortalOnboardingWalkthrough } from '@/components/portal/PortalOnboardingWalkthrough'

const mockMarkDone = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/useOnboardingFlag', () => ({
  useOnboardingFlag: () => ({ shouldShow: true, markDone: mockMarkDone }),
}))

// Step 1 ("ダッシュボード概要") targets `[data-walkthrough="portal-action-section"]`
// in the live app (see src/components/portal/dashboard/ActionSection.tsx).
function renderWithTarget() {
  return render(
    <>
      <div data-walkthrough="portal-action-section">action list</div>
      <PortalOnboardingWalkthrough />
    </>
  )
}

describe('PortalOnboardingWalkthrough spotlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to the centered dialog when targetSelector matches no element (regression guard)', async () => {
    render(<PortalOnboardingWalkthrough />)

    await waitFor(() => {
      expect(screen.getByText('ダッシュボード概要')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('walkthrough-spotlight-ring')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders a spotlight ring around the target element when it exists', async () => {
    renderWithTarget()

    await waitFor(() => {
      expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
    })
  })

  it('calls markDone (server + localStorage) when the walkthrough is completed', async () => {
    render(<PortalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('タスク詳細の見方'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('承認・修正依頼の使い方'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('準備完了です！'))
    fireEvent.click(screen.getByText('始めましょう'))

    await waitFor(() => {
      expect(mockMarkDone).toHaveBeenCalledTimes(1)
    })
  })
})
