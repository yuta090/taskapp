import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import PortalInvitePage from '@/app/portal/[token]/page'

/**
 * /portal/[token] の受諾動線。
 *
 * V5（vendor-portal / invite で導入済み）と同じ2つのガードを適用する:
 * 1. 既存ユーザーが未ログインの場合、パスワード検証に到達させずログインへ誘導する。
 * 2. ログイン中のメールが招待メールと一致しない場合、自動受諾せずアカウント切替を案内する
 *    （wrong-account join 防止）。
 */

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/portal/tok-1',
}))

const mockGetSession = vi.fn()
const mockSignInWithPassword = vi.fn()
const mockRpc = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      signInWithPassword: mockSignInWithPassword,
    },
    rpc: mockRpc,
  }),
}))

const { mockSignOutAndLeave } = vi.hoisted(() => ({
  mockSignOutAndLeave: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

const validInvite = {
  valid: true,
  email: 'invitee@example.com',
  role: 'client',
  org_id: 'org-1',
  org_name: 'テスト株式会社',
  space_id: 'space-1',
  space_name: 'テストプロジェクト',
  inviter_name: '管理者',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
  is_existing_user: false,
}

const mockFetch = vi.fn()

function session(email: string) {
  return { data: { session: { user: { id: 'user-1', email } } } }
}

function acceptResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: () =>
      Promise.resolve({
        org_id: 'org-1',
        space_id: 'space-1',
        role: 'client',
        email: validInvite.email,
        created: false,
        ...overrides,
      }),
  }
}

function fulfilledParams<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & { status: string; value: T }
  promise.status = 'fulfilled'
  promise.value = value
  return promise
}

function renderPage() {
  return render(
    <Suspense fallback={null}>
      <PortalInvitePage params={fulfilledParams({ token: 'tok-1' })} />
    </Suspense>
  )
}

let locationAssignSpy: ReturnType<typeof vi.fn>

describe('PortalInvitePage — 受諾動線', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockRpc.mockResolvedValue({ data: { ...validInvite }, error: null })
    mockFetch.mockResolvedValue(acceptResponse())
    mockSignInWithPassword.mockResolvedValue({ error: null })
    locationAssignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: locationAssignSpy },
      writable: true,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('既存ユーザーが未ログインで開いた場合、パスワード入力に到達させずログインへ誘導する', async () => {
    mockRpc.mockResolvedValue({ data: { ...validInvite, is_existing_user: true }, error: null })

    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ログインして参加' })).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/パスワードを設定/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'ポータルに参加' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ログインして参加' }))

    expect(mockPush).toHaveBeenCalledWith('/login?redirect=/portal/tok-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('ログイン中でも別アカウントなら自動受諾せず切替案内を表示（招待を消費しない）', async () => {
    mockGetSession.mockResolvedValue(session('other@example.com'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/別のアカウントでログイン中/)).toBeInTheDocument()
    })
    expect(screen.getByText('other@example.com')).toBeInTheDocument()
    expect(screen.getByText('invitee@example.com')).toBeInTheDocument()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  // /portal/[token] は proxy に保護されているため（未ログインでは開けない）、ログアウト後に
  // 同じURLへ戻ると /login?redirect=... に弾かれ、アカウントを持たないクライアントが招待を
  // 受け直せなくなる（回帰）。/invite/[token] は同じ token に対応する公開ページで、
  // role==='client' の招待は受諾後 /portal へ着地するため、必ずそちらへ戻す。
  // また、このボタンはログイン中に押されるので pushCleanup は既定(true)のまま渡す
  // （push購読の解除は必要）
  it('切替案内から「ログアウトして招待を受ける」で signOutAndLeave({ to: "/invite/tok-1" }) を呼ぶ（公開ページへ・pushCleanupは既定のまま）', async () => {
    mockGetSession.mockResolvedValue(session('other@example.com'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/別のアカウントでログイン中/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: /ログアウトして招待を受ける/ }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/invite/tok-1' })
    })
  })

  it('ログイン中でメールが一致すれば自動受諾してポータルへ（回帰・フルページ遷移）', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))

    renderPage()

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/invites/tok-1/accept',
        expect.objectContaining({ method: 'POST' })
      )
    })
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/portal')
    })
    expect(mockPush).not.toHaveBeenCalledWith('/portal')
  })

  it('未ログインの新規ユーザーはパスワード設定→受諾→ログイン→ポータルへ（回帰・フルページ遷移）', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByLabelText(/^パスワードを設定\*?$/)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/^パスワードを設定\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを作成して参加' }))

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: validInvite.email,
        password: 'password123',
      })
    })
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/portal')
    })
    expect(mockPush).not.toHaveBeenCalledWith('/portal')
  })

  it('無効な招待はエラーカードを表示（回帰）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid' } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('招待が無効です')).toBeInTheDocument()
    })
  })

  it('無効な招待は行き止まりにせず、次のアクションを案内する（B8）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid' } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('招待が無効です')).toBeInTheDocument()
    })

    expect(
      screen.getByText('リンクの再送が必要な場合は、プロジェクトの担当者にご連絡ください。')
    ).toBeInTheDocument()
  })

  // apiMfaGuard.ts は { error: 'mfa_required', message: '二要素認証のコード入力が必要です' }
  // という形の403を返す。error（合言葉）をそのまま出すと "mfa_required" という英語の
  // 内部符号が画面に出てしまうため、message があればそれを優先して出す
  it('二要素認証の門番に断られたら、"mfa_required" ではなくサーバーのmessageを出し、コード入力画面への案内も出す', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'mfa_required', message: '二要素認証のコード入力が必要です' }),
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('二要素認証のコード入力が必要です')).toBeInTheDocument()
    })
    expect(screen.queryByText('mfa_required')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '認証アプリのコードを入力する' })).toHaveAttribute(
      'href',
      '/login/mfa'
    )
  })
})
