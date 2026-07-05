import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ResetConfirmPage from '@/app/(auth)/reset/confirm/page'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/reset/confirm',
}))

const mockGetSession = vi.fn()
const mockUpdateUser = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      updateUser: mockUpdateUser,
    },
  }),
}))

async function renderReadyPage() {
  mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
  render(<ResetConfirmPage />)
  await waitFor(() => {
    expect(screen.getByText('新しいパスワードを設定')).toBeInTheDocument()
  })
}

describe('ResetConfirmPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should show a field-level error under the new password input for short passwords, not a banner', async () => {
    await renderReadyPage()

    fireEvent.change(screen.getByLabelText(/^新しいパスワード\*?$/), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText(/^パスワード（確認）\*?$/), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    const newPasswordInput = screen.getByLabelText(/^新しいパスワード\*?$/)
    await waitFor(() => {
      expect(newPasswordInput).toHaveAttribute('aria-invalid', 'true')
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('パスワードは8文字以上で入力してください')
    expect(newPasswordInput).toHaveAttribute('aria-describedby', alert.id)

    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('should show a field-level error under the confirm password input on mismatch, not a banner', async () => {
    await renderReadyPage()

    fireEvent.change(screen.getByLabelText(/^新しいパスワード\*?$/), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText(/^パスワード（確認）\*?$/), { target: { value: 'password456' } })
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    const confirmInput = screen.getByLabelText(/^パスワード（確認）\*?$/)
    await waitFor(() => {
      expect(confirmInput).toHaveAttribute('aria-invalid', 'true')
    })

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('パスワードが一致しません')
    expect(confirmInput).toHaveAttribute('aria-describedby', alert.id)

    expect(mockUpdateUser).not.toHaveBeenCalled()
  })

  it('should succeed when passwords are valid and match', async () => {
    await renderReadyPage()
    mockUpdateUser.mockResolvedValue({ error: null })

    fireEvent.change(screen.getByLabelText(/^新しいパスワード\*?$/), { target: { value: 'password123' } })
    fireEvent.change(screen.getByLabelText(/^パスワード（確認）\*?$/), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'パスワードを変更' }))

    await waitFor(() => {
      expect(screen.getByText('パスワードを変更しました')).toBeInTheDocument()
    })
  })
})
