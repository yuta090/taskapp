import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * /admin/login — 管理者ログイン画面。
 *
 * 要件: メール+パスワードに加えて Google でも入れる（運営アカウントが Google の合鍵で
 * ユーザーとしても運営としてもログインできるようにする）。Google から戻ってきたとき、
 * 旗が無いユーザーは (panel) layout に弾かれてこの画面へ戻されるので、
 * 「ログイン済みだが運営ではない」状態を検知して理由を出し、ログアウト手段を用意する。
 */

const pushMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: pushMock, refresh: vi.fn() }),
}))

const getUserMock = vi.fn()
const signOutMock = vi.fn()
const singleMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock,
      signInWithPassword: vi.fn(),
      signInWithOAuth: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
  }),
}))

const { default: AdminLoginPage } = await import('@/app/admin/login/page')

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: null } })
})

describe('AdminLoginPage', () => {
  it('Google でログインするボタンがある', async () => {
    render(<AdminLoginPage />)
    expect(await screen.findByRole('button', { name: /Google/ })).toBeInTheDocument()
  })

  it('ログイン済みで運営の旗があれば dashboard へ進む', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u-admin' } } })
    singleMock.mockResolvedValue({ data: { is_superadmin: true } })
    render(<AdminLoginPage />)
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/admin/dashboard'))
  })

  it('ログイン済みだが運営でなければ理由を表示し、ログアウトできる', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u-normal', email: 'normal@example.com' } } })
    singleMock.mockResolvedValue({ data: { is_superadmin: false } })
    render(<AdminLoginPage />)
    expect(await screen.findByText(/管理者権限がありません/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ログアウト/ })).toBeInTheDocument()
    expect(pushMock).not.toHaveBeenCalled()
  })
})
