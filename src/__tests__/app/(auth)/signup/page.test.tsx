import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SignupPage from '@/app/(auth)/signup/page'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/signup',
}))

const mockSignUp = vi.fn()
const mockRpc = vi.fn()
const mockResend = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signUp: mockSignUp,
      resend: mockResend,
    },
    rpc: mockRpc,
  }),
}))

function fillForm({ orgName = '株式会社テスト', email = 'test@example.com', password = 'password123' } = {}) {
  fireEvent.change(screen.getByLabelText(/^組織名\*?$/), { target: { value: orgName } })
  fireEvent.change(screen.getByLabelText(/^メールアドレス\*?$/), { target: { value: email } })
  fireEvent.change(screen.getByLabelText(/^パスワード\*?$/), { target: { value: password } })
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should show a field-level error under the password input for short passwords, not a banner', async () => {
    render(<SignupPage />)

    fillForm({ password: 'short' })
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => {
      expect(screen.getByText('パスワードは8文字以上で入力してください')).toBeInTheDocument()
    })

    // Not shown as a generic banner (role=alert used only for field-level error in AuthInput)
    expect(mockSignUp).not.toHaveBeenCalled()
  })

  it('should not call the org RPC when signUp succeeds without a session (email confirmation required)', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    })

    render(<SignupPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => {
      expect(screen.getByText('確認メールを送信しました')).toBeInTheDocument()
    })

    expect(mockRpc).not.toHaveBeenCalled()
  })

  it('should call the org RPC and continue to /onboarding (template step) when a session exists', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'tok' } },
      error: null,
    })
    mockRpc.mockResolvedValue({ error: null })

    render(<SignupPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('rpc_create_org_with_billing', {
        p_org_name: '株式会社テスト',
        p_user_id: 'user-1',
      })
    })

    await waitFor(() => {
      // 組織は出来たがプロジェクトが無い状態なので、テンプレート選択（Step2）へ
      expect(mockPush).toHaveBeenCalledWith('/onboarding')
    })
  })

  it('should show an error (not the success screen) when RPC fails with a session', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'tok' } },
      error: null,
    })
    mockRpc.mockResolvedValue({ error: { message: 'boom' } })

    render(<SignupPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => {
      expect(screen.getByText('組織の作成に失敗しました。もう一度お試しください。')).toBeInTheDocument()
    })

    expect(screen.queryByText('確認メールを送信しました')).not.toBeInTheDocument()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('should show the updated success screen copy with resend guidance', async () => {
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    })

    render(<SignupPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => {
      expect(screen.getByText('確認メールを送信しました')).toBeInTheDocument()
    })

    expect(
      screen.getByText('メール内のリンクをクリックすると、自動的にログインされ設定が続行されます。')
    ).toBeInTheDocument()
    expect(screen.getByText('メールが届かない場合は迷惑メールフォルダをご確認ください。')).toBeInTheDocument()
    expect(
      screen.getByText('既にアカウントをお持ちの場合、確認メールは届きません。ログインまたはパスワードリセットをお試しください。')
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ログイン' })).toHaveAttribute('href', '/login')
    expect(screen.getByRole('link', { name: 'パスワードリセット' })).toHaveAttribute('href', '/reset')
  })

  it('should resend the confirmation email and show a 60s cooldown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    mockSignUp.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: null },
      error: null,
    })
    mockResend.mockResolvedValue({ error: null })

    render(<SignupPage />)
    fillForm()
    fireEvent.click(screen.getByRole('button', { name: 'アカウント作成' }))

    await waitFor(() => {
      expect(screen.getByText('確認メールを送信しました')).toBeInTheDocument()
    })

    const resendButton = screen.getByRole('button', { name: /再送/ })
    fireEvent.click(resendButton)

    await waitFor(() => {
      expect(mockResend).toHaveBeenCalledWith({ type: 'signup', email: 'test@example.com' })
    })

    await waitFor(() => {
      expect(screen.getByText(/再送しました（60秒後に再送可能）/)).toBeInTheDocument()
    })

    vi.useRealTimers()
  })
})
