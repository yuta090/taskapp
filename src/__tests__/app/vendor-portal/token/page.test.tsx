import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Suspense } from 'react'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import VendorInvitePage from '@/app/vendor-portal/[token]/page'

/**
 * /vendor-portal/[token] の受諾動線。
 *
 * 既存ユーザーが未ログインの場合、パスワード検証に到達させずログインへ誘導する
 * （invite / portal ページと同様の CTA 修正）。
 */

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/vendor-portal/tok-1',
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
  role: 'vendor',
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
        role: 'vendor',
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
      <VendorInvitePage params={fulfilledParams({ token: 'tok-1' })} />
    </Suspense>
  )
}

let locationAssignSpy: ReturnType<typeof vi.fn>

describe('VendorInvitePage — 受諾動線', () => {
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
    expect(screen.queryByRole('button', { name: 'ベンダーポータルに参加' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ログインして参加' }))

    expect(mockPush).toHaveBeenCalledWith('/login?redirect=/vendor-portal/tok-1')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('ログイン中でも別アカウントなら自動受諾せず切替案内を表示（回帰）', async () => {
    mockGetSession.mockResolvedValue(session('other@example.com'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/別のアカウントでログイン中/)).toBeInTheDocument()
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('切替案内から「別のアカウントでログインし直す」で signOutAndLeave({ to: 現在のURL, pushCleanup: false }) を呼ぶ', async () => {
    mockGetSession.mockResolvedValue(session('other@example.com'))

    renderPage()

    await waitFor(() => {
      expect(screen.getByText(/別のアカウントでログイン中/)).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '別のアカウントでログインし直す' }))

    await waitFor(() => {
      expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: window.location.href, pushCleanup: false })
    })
  })

  it('ログイン中でメールが一致すれば自動受諾してベンダーポータルへ（回帰・フルページ遷移）', async () => {
    mockGetSession.mockResolvedValue(session('invitee@example.com'))

    renderPage()

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/vendor-portal')
    })
    expect(mockPush).not.toHaveBeenCalledWith('/vendor-portal')
  })

  it('未ログインの新規ユーザーはパスワード設定→受諾→ログイン→ベンダーポータルへ（回帰・フルページ遷移）', async () => {
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
      expect(locationAssignSpy).toHaveBeenCalledWith('/vendor-portal')
    })
    expect(mockPush).not.toHaveBeenCalledWith('/vendor-portal')
  })

  it('無効な招待はエラーカードを表示（回帰）', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid' } })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('招待が無効です')).toBeInTheDocument()
    })
  })
})
