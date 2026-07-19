import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SetupChecklist } from '@/components/onboarding/SetupChecklist'

const ORG_ID = 'org-1'
const SPACE_ID = 'space-1'

const mockMarkDone = vi.fn().mockResolvedValue(undefined)
const mockUseOnboardingFlag = vi.fn()
const mockUseSetupChecklistData = vi.fn()

vi.mock('@/lib/hooks/useOnboardingFlag', () => ({
  useOnboardingFlag: (...args: unknown[]) => mockUseOnboardingFlag(...args),
}))

vi.mock('@/lib/hooks/useSetupChecklistData', () => ({
  useSetupChecklistData: (...args: unknown[]) => mockUseSetupChecklistData(...args),
}))

const ALL_UNDONE = {
  currentUserRole: 'admin',
  loading: false,
  hasNonSampleTask: false,
  hasTeamInvite: false,
  hasClientInvite: false,
  hasPublishedTask: false,
  hasPreviewedPortal: false,
  hasLineLinked: false,
  // 既定は「LINE秘書が用意済み（自分で連携できる）」状態。準備中ケースは個別に lineAccountReady:false を渡す
  lineAccountReady: true,
}

function setup(dataOverrides: Partial<typeof ALL_UNDONE> = {}, shouldShow: boolean | null = true) {
  mockUseOnboardingFlag.mockReturnValue({ shouldShow, markDone: mockMarkDone })
  mockUseSetupChecklistData.mockReturnValue({ ...ALL_UNDONE, ...dataOverrides })
}

describe('SetupChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkDone.mockResolvedValue(undefined)
  })

  it('renders nothing while checklist data is loading', () => {
    setup({ loading: true })
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument()
  })

  it('renders nothing for the client role', () => {
    setup({ currentUserRole: 'client' })
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument()
  })

  it('renders nothing while the dismissed flag is still being checked (shouldShow=null)', () => {
    setup({}, null)
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument()
  })

  it('renders nothing once dismissed (shouldShow=false)', () => {
    setup({}, false)
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)
    expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument()
  })

  it('shows progress count and per-step done/undone state for partial completion', () => {
    setup({ hasNonSampleTask: true, hasTeamInvite: true })
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    expect(screen.getByTestId('setup-checklist')).toBeInTheDocument()
    // LINE秘書が準備済みなので connect_line を含めた6ステップ
    expect(screen.getByText('はじめての設定 2/6')).toBeInTheDocument()
    expect(screen.getByText('最初のタスクを作成')).toBeInTheDocument()
    expect(screen.getByText('クライアントを招待', { selector: 'p' })).toBeInTheDocument()

    // undone steps with a navigable CTA render a link
    const inviteClientLink = screen.getByRole('link', { name: 'クライアントを招待' })
    expect(inviteClientLink).toHaveAttribute('href', '/settings/members')

    // done steps render no CTA link
    expect(screen.queryByRole('link', { name: 'メンバーを招待' })).not.toBeInTheDocument()
  })

  it('links the preview_portal CTA to /portal/preview/{spaceId}', () => {
    setup()
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    const previewLink = screen.getByRole('link', { name: 'プレビュー' })
    expect(previewLink).toHaveAttribute('href', `/portal/preview/${SPACE_ID}`)
  })

  it('links the connect_line CTA to the secretary console when the bot is ready but unlinked', () => {
    setup()
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    const lineLink = screen.getByRole('link', { name: 'LINEを連携' })
    expect(lineLink).toHaveAttribute('href', `/${ORG_ID}/secretary/connect/line`)
  })

  it('marks the first incomplete step as the current step ("今ここ")', () => {
    setup({ hasNonSampleTask: true })
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    const currentStep = screen.getByTestId('setup-step-invite_team')
    expect(currentStep).toHaveAttribute('data-current', 'true')
    expect(screen.getByText('今ここ')).toBeInTheDocument()
  })

  it('shows connect_line as "準備中" with no CTA when the LINE bot is not provisioned', () => {
    setup({ hasNonSampleTask: true, hasTeamInvite: true, lineAccountReady: false })
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    // pending ステップは分母から除外され、5ステップ基準の進捗になる
    expect(screen.getByText('はじめての設定 2/5')).toBeInTheDocument()
    expect(screen.getByText('準備中')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'LINEを連携' })).not.toBeInTheDocument()
  })

  it('dismisses the checklist via markDone when "非表示にする" is clicked', () => {
    setup()
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    fireEvent.click(screen.getByText('非表示にする'))
    expect(mockMarkDone).toHaveBeenCalledTimes(1)
  })

  it('collapses and expands the step list without dismissing', () => {
    setup()
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    expect(screen.getByText('最初のタスクを作成')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('setup-checklist-toggle'))
    expect(screen.queryByText('最初のタスクを作成')).not.toBeInTheDocument()
    expect(mockMarkDone).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('setup-checklist-toggle'))
    expect(screen.getByText('最初のタスクを作成')).toBeInTheDocument()
  })

  it('shows a one-time completion message and auto-persists dismissal when every step is done', () => {
    setup({
      hasNonSampleTask: true,
      hasTeamInvite: true,
      hasClientInvite: true,
      hasPublishedTask: true,
      hasPreviewedPortal: true,
      hasLineLinked: true,
    })
    render(<SetupChecklist orgId={ORG_ID} spaceId={SPACE_ID} />)

    expect(screen.getByTestId('setup-checklist-complete')).toBeInTheDocument()
    expect(screen.getByText('セットアップ完了！🎉')).toBeInTheDocument()
    expect(screen.queryByTestId('setup-checklist')).not.toBeInTheDocument()
    expect(mockMarkDone).toHaveBeenCalledTimes(1)
  })
})
