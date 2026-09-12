import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import AdminLoginPage from '@/app/admin/login/page'

/**
 * 運営ログイン画面。運営かどうかの判定は、profiles.is_superadmin を本人のセッションで
 * 直接読む形から rpc_is_superadmin() に揃える。42501+message='mfa_required'（二要素認証
 * 未入力による db_pre_request の拒否）は、rpc_is_superadmin() を呼んでも同じ組み合わせで
 * 返ってくる（db_pre_request はテーブル/RPCを問わない role/セッション単位の見張りのため）。
 *
 * 42501+message='mfa_required' は「運営でない」とは別に扱う: サインアウトせず
 * ADMIN_HOME へ進める。(panel) layout の verifySuperadminDetailed が二要素認証の状態を
 * あらためて確かめ、必要なら /login/mfa?redirect=/admin/dashboard へ回す。
 * 42501 は「関数の実行権が無い」等、二要素の途中とは別の理由でも返るため、message まで
 * 一致しない場合は「運営でない」にも化けさせず、確認できなかった旨を出す。
 */

vi.mock('@/components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: ({ label }: { label: string }) => <button type="button">{label}</button>,
}))
vi.mock('@/components/brand/AgentPmMark', () => ({
  AgentPmMark: () => null,
}))

const replaceMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
}))

let existingSessionUser: { id: string; email?: string } | null = null
let rpcResponse: { data: boolean | null; error: { code: string; message?: string } | null } = {
  data: null,
  error: null,
}
const rpcMock = vi.fn((..._args: unknown[]) => Promise.resolve(rpcResponse))
const signOutMock = vi.fn(() => Promise.resolve({ error: null }))
let signInResponse: { data: { user: { id: string } | null }; error: { message: string } | null }
const signInMock = vi.fn(() => Promise.resolve(signInResponse))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: () => Promise.resolve({ data: { user: existingSessionUser } }),
      signOut: signOutMock,
      signInWithPassword: signInMock,
    },
    rpc: (...args: unknown[]) => rpcMock(...args),
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  existingSessionUser = null
  rpcResponse = { data: null, error: null }
  signInResponse = { data: { user: null }, error: null }
})

describe('AdminLoginPage', () => {
  it('Google でログインするボタンがある', async () => {
    render(<AdminLoginPage />)
    expect(await screen.findByRole('button', { name: /Google/ })).toBeInTheDocument()
  })
})

describe('AdminLoginPage — 既存セッションの運営判定（rpc_is_superadmin 経由）', () => {
  it('運営(true)なら管理画面へ進む', async () => {
    existingSessionUser = { id: 'admin-1', email: 'admin@example.com' }
    rpcResponse = { data: true, error: null }

    render(<AdminLoginPage />)

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin'))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/admin/dashboard'))
  })

  it('運営でない(false)なら、権限が無い旨を出しログアウトできる', async () => {
    existingSessionUser = { id: 'user-1', email: 'user@example.com' }
    rpcResponse = { data: false, error: null }

    render(<AdminLoginPage />)

    await waitFor(() => expect(screen.getByText('管理者権限がありません')).toBeInTheDocument())
    expect(replaceMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /ログアウト/ }))
    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
    expect(screen.queryByText('管理者権限がありません')).not.toBeInTheDocument()
  })

  it('42501+message=mfa_required（二要素認証未入力）は運営でないのとは別に扱い、サインアウトせずADMIN_HOMEへ進める', async () => {
    existingSessionUser = { id: 'admin-1', email: 'admin@example.com' }
    rpcResponse = { data: null, error: { code: '42501', message: 'mfa_required' } }

    render(<AdminLoginPage />)

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin'))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/admin/dashboard'))
    expect(screen.queryByText('管理者権限がありません')).not.toBeInTheDocument()
  })

  // 42501は「関数の実行権が無い」等、二要素の途中とは別の理由でも返る符号。
  // messageまで一致しない場合は「運営でない」にも化けさせず、確認できなかった旨を出す
  it('42501でもmessageがmfa_requiredでなければ、確認できなかった旨を出す（進めない）', async () => {
    existingSessionUser = { id: 'admin-1', email: 'admin@example.com' }
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied for function rpc_is_superadmin' } }

    render(<AdminLoginPage />)

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin'))
    await waitFor(() => expect(screen.getByText('確認できませんでした。もう一度お試しください。')).toBeInTheDocument())
    expect(replaceMock).not.toHaveBeenCalled()
  })
})

describe('AdminLoginPage — パスワードログイン後の運営判定（rpc_is_superadmin 経由）', () => {
  it('運営(true)ならサインアウトせずに進む', async () => {
    signInResponse = { data: { user: { id: 'admin-1' } }, error: null }
    rpcResponse = { data: true, error: null }
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign: assignSpy }, writable: true })

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin'))
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/admin/dashboard'))
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('運営でない(false)ならサインアウトして理由を出す', async () => {
    signInResponse = { data: { user: { id: 'user-1' } }, error: null }
    rpcResponse = { data: false, error: null }

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
    expect(screen.getByText('管理者権限がありません')).toBeInTheDocument()
  })

  it('42501+message=mfa_required（二要素認証未入力）は運営でないのとは別に扱い、サインアウトせずADMIN_HOMEへ進める', async () => {
    signInResponse = { data: { user: { id: 'admin-1' } }, error: null }
    rpcResponse = { data: null, error: { code: '42501', message: 'mfa_required' } }
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign: assignSpy }, writable: true })

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(rpcMock).toHaveBeenCalledWith('rpc_is_superadmin'))
    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/admin/dashboard'))
    expect(signOutMock).not.toHaveBeenCalled()
  })

  it('42501でもmessageがmfa_requiredでなければサインアウトし、確認できなかった旨を出す', async () => {
    signInResponse = { data: { user: { id: 'admin-1' } }, error: null }
    rpcResponse = { data: null, error: { code: '42501', message: 'permission denied for function rpc_is_superadmin' } }

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
    expect(screen.getByText('確認できませんでした。もう一度お試しください。')).toBeInTheDocument()
  })

  // window.location.assign() は遷移を予約するだけですぐ返るため、成功直後に loading を解除すると
  // 実際にページが切り替わるまでボタンが一瞬押せる状態に戻り、遅い回線で二重送信を招く。
  it('ログイン成功後、ボタンはページが破棄されるまでローディング表示のまま', async () => {
    signInResponse = { data: { user: { id: 'admin-1' } }, error: null }
    rpcResponse = { data: true, error: null }
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign: assignSpy }, writable: true })

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/admin/dashboard'))
    expect(screen.getByText('処理中...')).toBeInTheDocument()
    expect(screen.getByText('処理中...').closest('button')).toBeDisabled()
  })

  // iPhone Safari 等が bfcache（swipe back）からこのページをそのまま復元すると、ページは
  // 実際には破棄されておらず、成功直後に維持しているローディングを戻す機会が無いまま
  // ボタンが永久に押せなくなる。pageshow(persisted:true) を検知したら解除する。
  it('ログイン成功後にbfcacheから復元されたら、ローディングを解除する', async () => {
    signInResponse = { data: { user: { id: 'admin-1' } }, error: null }
    rpcResponse = { data: true, error: null }
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign: assignSpy }, writable: true })

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(assignSpy).toHaveBeenCalledWith('/admin/dashboard'))
    expect(screen.getByText('処理中...').closest('button')).toBeDisabled()

    const event = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)

    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })

  it('メール・パスワードが正しくない場合は、ボタンのローディングを解除する', async () => {
    signInResponse = { data: { user: null }, error: { message: 'invalid' } }

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'admin@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByText('メールアドレスまたはパスワードが正しくありません')).toBeInTheDocument()
    })
    expect(rpcMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })

  it('運営権限が無い場合も、ボタンのローディングを解除する', async () => {
    signInResponse = { data: { user: { id: 'user-1' } }, error: null }
    rpcResponse = { data: false, error: null }

    render(<AdminLoginPage />)
    fireEvent.change(screen.getByPlaceholderText('admin@example.com'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByPlaceholderText('パスワードを入力'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => expect(screen.getByText('管理者権限がありません')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })
})
