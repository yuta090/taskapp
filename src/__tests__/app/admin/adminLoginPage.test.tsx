import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

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
const signInWithPasswordMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: getUserMock,
      signOut: signOutMock,
      signInWithPassword: signInWithPasswordMock,
      signInWithOAuth: vi.fn(),
    },
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
  }),
}))

const { default: AdminLoginPage } = await import('@/app/admin/login/page')

let locationAssignSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: null } })
  locationAssignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign: locationAssignSpy },
    writable: true,
  })
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

  it('メール+パスワードで運営としてログインに成功すると、フルページ遷移で dashboard へ（router.push はしない）', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u-admin' } }, error: null })
    singleMock.mockResolvedValue({ data: { is_superadmin: true } })

    render(<AdminLoginPage />)
    await screen.findByRole('button', { name: /Google/ })

    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/admin/dashboard')
    })
    expect(pushMock).not.toHaveBeenCalledWith('/admin/dashboard')
  })

  // window.location.assign() は遷移を予約するだけですぐ返るため、成功直後に loading を解除すると
  // 実際にページが切り替わるまでボタンが一瞬押せる状態に戻り、遅い回線で二重送信を招く。
  it('ログイン成功後、ボタンはページが破棄されるまでローディング表示のまま', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u-admin' } }, error: null })
    singleMock.mockResolvedValue({ data: { is_superadmin: true } })

    render(<AdminLoginPage />)
    await screen.findByRole('button', { name: /Google/ })

    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/admin/dashboard')
    })
    expect(screen.getByText('処理中...')).toBeInTheDocument()
    expect(screen.getByText('処理中...').closest('button')).toBeDisabled()
  })

  it('ログイン失敗時は、ボタンのローディングを解除する', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })

    render(<AdminLoginPage />)
    await screen.findByRole('button', { name: /Google/ })

    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), {
      target: { value: 'admin@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), {
      target: { value: 'wrong' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByText('メールアドレスまたはパスワードが正しくありません')).toBeInTheDocument()
    })
    expect(locationAssignSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })

  it('運営権限が無い場合も、ボタンのローディングを解除する', async () => {
    signInWithPasswordMock.mockResolvedValue({ data: { user: { id: 'u-normal' } }, error: null })
    singleMock.mockResolvedValue({ data: { is_superadmin: false } })

    render(<AdminLoginPage />)
    await screen.findByRole('button', { name: /Google/ })

    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), {
      target: { value: 'normal@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getAllByText(/管理者権限がありません/).length).toBeGreaterThan(0)
    })
    expect(locationAssignSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })
})
