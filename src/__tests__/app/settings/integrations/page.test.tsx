import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import UserIntegrationsPage from '@/app/settings/integrations/page'
import { getSetupGuide } from '@/lib/integrations/setupGuides'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

const mockUseIntegrations = vi.fn()
vi.mock('@/lib/hooks/useIntegrations', () => ({
  useIntegrations: (...args: unknown[]) => mockUseIntegrations(...args),
}))

const mockIsGoogleCalendarConfigured = vi.fn(() => false)
vi.mock('@/lib/google-calendar/config', () => ({
  isGoogleCalendarConfigured: () => mockIsGoogleCalendarConfigured(),
}))

// ToolSetupGuide（連携のしかた）は本物を使う。ここが差し替わると「手順が出ているか」を
// 検証できなくなるため、他の飾り(バッジ・旧SetupGuide)だけを軽量スタブに置き換える。
vi.mock('@/components/integrations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/integrations')>()
  return {
    ...actual,
    IntegrationStatusBadge: () => <span />,
    SetupGuide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }
})

describe('UserIntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // clearAllMocks は実装を消さないため、テスト間で引きずらないよう既定値へ戻す
    mockIsGoogleCalendarConfigured.mockReturnValue(false)

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'member',
      loading: false,
      error: null,
    })

    mockUseIntegrations.mockReturnValue({
      loading: false,
      error: null,
      connectGoogle: vi.fn(),
      disconnect: vi.fn(),
      getConnection: () => null,
      isConnected: () => false,
    })
  })

  it('labels the page as the personal integrations page', () => {
    render(<UserIntegrationsPage />)

    // 用語は「外部連携」→「ツール連携」に統一済み（UIの言葉のルール）
    expect(screen.getByText('個人のツール連携')).toBeInTheDocument()
    expect(screen.getByText('あなた個人のアカウント接続（Google カレンダー・ビデオ会議）')).toBeInTheDocument()
  })

  it('shows a banner guiding users to the org integrations page for Slack/GitHub/AI', () => {
    render(<UserIntegrationsPage />)

    expect(screen.getByText(/Slack・GitHub・AI 連携をお探しですか？/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /組織の外部連携を開く/ })
    expect(link).toHaveAttribute('href', '/settings/org-integrations')
  })

  /**
   * 連携のしかた — 手順の文言は setupGuides.ts（単一の真実源）に置き、この画面では
   * ToolSetupGuide を呼ぶだけにする。画面ごとに手順を書き写さない。
   */
  describe('連携のしかた', () => {
    it('未接続のGoogleカレンダーは手順が開いた状態で出る（まず読んでほしいため）', () => {
      mockIsGoogleCalendarConfigured.mockReturnValue(true)
      render(<UserIntegrationsPage />)

      expect(screen.getByText(getSetupGuide('google_calendar')!.steps[0])).toBeInTheDocument()
    })

    it('接続済みのGoogleカレンダーは閉じた状態で出る（画面を手順で埋めない）', () => {
      mockIsGoogleCalendarConfigured.mockReturnValue(true)
      mockUseIntegrations.mockReturnValue({
        loading: false,
        error: null,
        connectGoogle: vi.fn(),
        connectProvider: vi.fn(),
        disconnect: vi.fn(),
        getConnection: () => ({ id: 'conn-1', scopes: 'calendar.freebusy', updated_at: null }),
        isConnected: (provider: string) => provider === 'google_calendar',
      })
      render(<UserIntegrationsPage />)

      expect(screen.queryByText(getSetupGuide('google_calendar')!.steps[0])).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /連携のしかた/ }))
      expect(screen.getByText(getSetupGuide('google_calendar')!.steps[0])).toBeInTheDocument()
    })

    it('ビデオ会議(Zoom/Teams)にも手順を出す（従来は説明が無かった）', () => {
      vi.stubEnv('NEXT_PUBLIC_ZOOM_ENABLED', 'true')
      vi.stubEnv('NEXT_PUBLIC_TEAMS_ENABLED', 'true')
      render(<UserIntegrationsPage />)

      const buttons = screen.getAllByRole('button', { name: /連携のしかた/ })
      expect(buttons.length).toBeGreaterThanOrEqual(2)

      fireEvent.click(buttons[0])
      expect(screen.getByText(getSetupGuide('zoom')!.steps[0])).toBeInTheDocument()

      vi.unstubAllEnvs()
    })
  })
})
