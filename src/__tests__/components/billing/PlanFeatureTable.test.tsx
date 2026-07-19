import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { PlanFeatureTable } from '@/components/billing/PlanFeatureTable'

function mockLimits(planName: string, features: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan_name: planName, features }) }),
  )
}

describe('PlanFeatureTable', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('Pro差別化機能の行と Free/Pro/Enterprise 列を表示する', async () => {
    mockLimits('Free', [])
    render(<PlanFeatureTable orgId="org-1" />)
    expect(screen.getByText('即時通知')).toBeInTheDocument()
    expect(screen.getByText('時刻指定リマインド')).toBeInTheDocument()
    expect(screen.getByText('自社名義LINE')).toBeInTheDocument()
    expect(screen.getByText('担当者への個別DM')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Free/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Pro/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Enterprise/ })).toBeInTheDocument()
  })

  it('Free 行は✗（利用不可）、Pro/Enterprise は✓（利用可能）', async () => {
    mockLimits('Free', [])
    render(<PlanFeatureTable orgId="org-1" />)
    // 4機能 × Free列 = 4つの「利用不可」、× (Pro+Enterprise) = 8つの「利用可能」
    await waitFor(() => {
      expect(screen.getAllByLabelText('利用不可')).toHaveLength(4)
    })
    expect(screen.getAllByLabelText('利用可能')).toHaveLength(8)
  })

  it('現在プラン（Pro）列に「現在」バッジを付ける', async () => {
    mockLimits('Pro', ['timed_line_reminders', 'own_line_account'])
    render(<PlanFeatureTable orgId="org-1" />)
    const proHeader = await screen.findByRole('columnheader', { name: /Pro/ })
    expect(within(proHeader).getByText('現在')).toBeInTheDocument()
    // Free 列には「現在」は付かない
    const freeHeader = screen.getByRole('columnheader', { name: /Free/ })
    expect(within(freeHeader).queryByText('現在')).not.toBeInTheDocument()
  })
})
