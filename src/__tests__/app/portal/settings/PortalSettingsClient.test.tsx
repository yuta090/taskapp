import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortalSettingsClient } from '@/app/portal/settings/PortalSettingsClient'

const toggleMock = vi.fn(() => Promise.resolve())
let remindersEnabled = true

vi.mock('next/navigation', () => ({
  usePathname: () => '/portal/settings',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/usePortalVisibility', () => ({
  usePortalVisibilityForPortal: () => ({
    sections: {
      tasks: true,
      requests: true,
      all_tasks: true,
      files: true,
      meetings: true,
      wiki: true,
      history: true,
    },
    loading: false,
  }),
}))

vi.mock('@/lib/hooks/useReminderPreference', () => ({
  useReminderPreference: () => ({
    enabled: remindersEnabled,
    toggle: toggleMock,
    saving: false,
  }),
}))

vi.mock('@/lib/hooks/useIntegrations', () => ({
  useIntegrations: () => ({
    loading: false,
    connectGoogle: vi.fn(),
    disconnect: vi.fn(),
    getConnection: () => null,
    isConnected: () => false,
  }),
}))

vi.mock('@/lib/google-calendar/config', () => ({
  isGoogleCalendarConfigured: () => false,
}))

const baseProps = {
  currentProject: { id: 'space-1', name: 'ECサイトリニューアル', orgId: 'org-1', orgName: 'クラフトテック' },
  projects: [{ id: 'space-1', name: 'ECサイトリニューアル', orgId: 'org-1', orgName: 'クラフトテック' }],
  user: { id: 'user-1', email: 'client@example.com', displayName: 'クライアント太郎' },
}

describe('PortalSettingsClient reminder toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    remindersEnabled = true
  })

  it('renders the reminder email toggle checked when enabled', () => {
    render(<PortalSettingsClient {...baseProps} />)

    const toggle = screen.getByTestId('portal-reminder-emails-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })

  it('renders the reminder email toggle unchecked when disabled', () => {
    remindersEnabled = false
    render(<PortalSettingsClient {...baseProps} />)

    const toggle = screen.getByTestId('portal-reminder-emails-toggle') as HTMLInputElement
    expect(toggle.checked).toBe(false)
  })

  it('calls toggle when the reminder email switch is clicked', () => {
    render(<PortalSettingsClient {...baseProps} />)

    const toggle = screen.getByTestId('portal-reminder-emails-toggle')
    fireEvent.click(toggle)

    expect(toggleMock).toHaveBeenCalledTimes(1)
  })
})
