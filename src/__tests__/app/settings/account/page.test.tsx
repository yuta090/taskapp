import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AccountSettingsPage from '@/app/settings/account/page'

/**
 * アカウント設定ページの「秘書からの期限リマインドを受け取る（LINE）」トグル
 * (profiles.due_reminder_enabled)。保存ボタン無しの楽観的更新（プロジェクト規約）。
 */

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/image', () => ({
  default: () => <div data-testid="avatar-image" />,
}))

const mockUseCurrentUser = vi.fn()
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUseCurrentUser(),
}))

const mockMaybeSingle = vi.fn()
const mockUpsert = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/components/shared', () => ({
  SettingsBackButton: () => <button type="button">Back</button>,
}))

const USER = {
  id: 'user-1',
  email: 'taro@example.com',
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
  last_sign_in_at: '2026-07-20T00:00:00.000Z',
}

describe('AccountSettingsPage due reminder opt-out toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCurrentUser.mockReturnValue({ user: USER, loading: false })

    mockUpsert.mockReturnValue({
      select: () => ({
        single: () => Promise.resolve({ data: { id: 'user-1' }, error: null }),
      }),
    })

    mockFrom.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: mockMaybeSingle,
        }),
      }),
      upsert: mockUpsert,
    }))
  })

  it('shows the toggle enabled when profiles.due_reminder_enabled is true', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: '太郎', avatar_url: null, due_reminder_enabled: true },
      error: null,
    })

    render(<AccountSettingsPage />)

    const toggle = await screen.findByRole('checkbox', { name: /秘書からの期限リマインドを受け取る/ })
    expect(toggle).toBeChecked()
  })

  it('shows the toggle disabled when profiles.due_reminder_enabled is false', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: '太郎', avatar_url: null, due_reminder_enabled: false },
      error: null,
    })

    render(<AccountSettingsPage />)

    const toggle = await screen.findByRole('checkbox', { name: /秘書からの期限リマインドを受け取る/ })
    expect(toggle).not.toBeChecked()
  })

  it('optimistically flips and upserts due_reminder_enabled=false on toggle-off (no save button)', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: '太郎', avatar_url: null, due_reminder_enabled: true },
      error: null,
    })

    render(<AccountSettingsPage />)

    const toggle = await screen.findByRole('checkbox', { name: /秘書からの期限リマインドを受け取る/ })
    fireEvent.click(toggle)

    expect(toggle).not.toBeChecked()

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('profiles')
      expect(mockUpsert).toHaveBeenCalledWith(
        { id: 'user-1', due_reminder_enabled: false },
        { onConflict: 'id' },
      )
    })
  })

  it('shows explanatory copy about what turning it off affects', async () => {
    mockMaybeSingle.mockResolvedValue({
      data: { display_name: '太郎', avatar_url: null, due_reminder_enabled: true },
      error: null,
    })

    render(<AccountSettingsPage />)

    await screen.findByRole('checkbox', { name: /秘書からの期限リマインドを受け取る/ })
    expect(
      screen.getByText(/オフにすると、期限が近いタスクの自動リマインドが届かなくなります/),
    ).toBeInTheDocument()
  })
})
