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
const mockUpsertSelect = vi.fn()
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

    mockUpsertSelect.mockReturnValue({
      single: () => Promise.resolve({ data: { id: 'user-1' }, error: null }),
    })
    mockUpsert.mockReturnValue({
      select: mockUpsertSelect,
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

// DB 側で、ログイン中の人が profiles の一部の列（運営の印など）を読めない形にする
// 変更が入っても、この画面は影響を受けないこと（読み返す列を必要なものだけに絞る）
describe('AccountSettingsPage — 表示名の保存で読み返す列', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCurrentUser.mockReturnValue({ user: USER, loading: false })

    mockMaybeSingle.mockResolvedValue({
      data: { display_name: '太郎', avatar_url: null, due_reminder_enabled: true },
      error: null,
    })

    mockUpsertSelect.mockReturnValue({
      single: () => Promise.resolve({ data: { id: 'user-1' }, error: null }),
    })
    mockUpsert.mockReturnValue({
      select: mockUpsertSelect,
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

  it('保存時に読み返す列を、必要な列(id)だけに絞る', async () => {
    render(<AccountSettingsPage />)

    const input = await screen.findByPlaceholderText('表示名を入力')
    fireEvent.change(input, { target: { value: '次郎' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(mockUpsert).toHaveBeenCalledWith({ id: 'user-1', display_name: '次郎' })
      expect(mockUpsertSelect).toHaveBeenCalledWith('id')
    })
  })
})
