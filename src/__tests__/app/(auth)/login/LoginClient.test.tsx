import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import LoginClient from '@/app/(auth)/login/LoginClient'

let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/login',
}))

let locationAssignSpy: ReturnType<typeof vi.fn>
function stubLocationAssign() {
  locationAssignSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, assign: locationAssignSpy },
    writable: true,
  })
}

const mockSignInWithPassword = vi.fn()
const mockGetSession = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { mfa: { getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }) }, 
      signInWithPassword: mockSignInWithPassword,
      getSession: mockGetSession,
    },
    from: mockFrom,
  }),
}))

describe('LoginClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    stubLocationAssign()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ order: mockOrder })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ single: mockSingle })
    mockSingle.mockResolvedValue({ data: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('should show the demo accounts section outside production', () => {
    render(<LoginClient />)

    expect(screen.getByText('テスト用デモアカウント')).toBeInTheDocument()
  })

  it('should hide the demo accounts section in production', () => {
    vi.stubEnv('NODE_ENV', 'production')

    render(<LoginClient />)

    expect(screen.queryByText('テスト用デモアカウント')).not.toBeInTheDocument()
  })

  it('should show the demo accounts section in production when explicitly enabled', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS', 'true')

    render(<LoginClient />)

    expect(screen.getByText('テスト用デモアカウント')).toBeInTheDocument()
  })

  it('プロバイダエラーは「キャンセル」ではなく理由コード付きで表示する', () => {
    mockSearchParams = new URLSearchParams('error=auth_provider_error&reason=unexpected_failure')

    render(<LoginClient />)

    expect(screen.getByText(/Google\/Supabase側で拒否されました/)).toBeInTheDocument()
    expect(screen.getByText(/unexpected_failure/)).toBeInTheDocument()
    expect(screen.queryByText(/キャンセル/)).not.toBeInTheDocument()
    mockSearchParams = new URLSearchParams()
  })

  it('理由コードは無害化してから表示する（URL経由の文字列を素通しにしない）', () => {
    mockSearchParams = new URLSearchParams('error=auth_callback_failed&reason=%3Cscript%3Ealert(1)%3C/script%3E')

    render(<LoginClient />)

    expect(screen.getByText(/理由: scriptalert1script/)).toBeInTheDocument()
    mockSearchParams = new URLSearchParams()
  })

  it('should render the Google sign-in button before the email/password form', () => {
    render(<LoginClient />)

    const googleButton = screen.getByRole('button', { name: 'Googleでログイン' })
    const emailInput = screen.getByLabelText(/^メールアドレス\*?$/)

    expect(googleButton.compareDocumentPosition(emailInput) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('should not show a logged-in banner when there is no session', async () => {
    render(<LoginClient />)

    await waitFor(() => {
      expect(mockGetSession).toHaveBeenCalled()
    })

    expect(screen.queryByText(/としてログイン中です/)).not.toBeInTheDocument()
  })

  it('should show a logged-in banner with the current email when a session exists', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'already@example.com' } } },
    })

    render(<LoginClient />)

    await waitFor(() => {
      expect(screen.getByText('already@example.com としてログイン中です')).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: 'アプリへ戻る' })).toBeInTheDocument()

    // Form should remain usable for switching accounts
    expect(screen.getByLabelText(/^メールアドレス\*?$/)).toBeInTheDocument()
  })
})

describe('LoginClient — ログイン後リダイレクト', () => {
  let membershipResponse: { data: { org_id: string; role: string }[] | null }
  let spaceResponse: { data: { id: string } | null }
  let vendorResponse: { data: { id: string } | null }

  // テーブルごとにチェーンを分ける（org_memberships / spaces / space_memberships）
  // org_memberships は resolvePostLoginLanding が全件取得するため limit/single を挟まない
  function setupTableMocks() {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'spaces') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn(() => Promise.resolve(spaceResponse)),
        }
      }
      if (table === 'space_memberships') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => Promise.resolve(vendorResponse)),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve(membershipResponse)),
      }
    })
  }

  async function login() {
    render(<LoginClient />)
    fireEvent.change(screen.getByLabelText(/^メールアドレス\*?$/), {
      target: { value: 'user@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^パスワード\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalled()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    stubLocationAssign()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    membershipResponse = { data: null }
    spaceResponse = { data: null }
    vendorResponse = { data: null }
    setupTableMocks()
  })

  it('組織未所属なら /onboarding へ（/inbox の空画面に落とさない）', async () => {
    await login()
    expect(locationAssignSpy).toHaveBeenCalledWith('/onboarding')
  })

  it('組織はあるがプロジェクトが無ければ /onboarding へ（Step2から再開）', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'owner' }] }
    spaceResponse = { data: null }
    await login()
    expect(locationAssignSpy).toHaveBeenCalledWith('/onboarding')
  })

  it('組織もプロジェクトもあれば最初のプロジェクトへ', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'owner' }] }
    spaceResponse = { data: { id: 'space-1' } }
    await login()
    expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
  })

  it('clientロールは /portal へ', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'client' }] }
    await login()
    expect(locationAssignSpy).toHaveBeenCalledWith('/portal')
  })

  it('clientロールでも同org内にvendorのspace所属があれば /vendor-portal へ', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'client' }] }
    vendorResponse = { data: { id: 'sm-1' } }
    await login()
    expect(locationAssignSpy).toHaveBeenCalledWith('/vendor-portal')
  })

  it('ACTIVE_ORG_COOKIE があれば複数org所属時にそちらを優先する（org切替中の着地）', async () => {
    membershipResponse = {
      data: [
        { org_id: 'org-1', role: 'owner' },
        { org_id: 'org-2', role: 'client' },
      ],
    }
    document.cookie = 'taskapp:activeOrgId=org-2'
    try {
      await login()
      expect(locationAssignSpy).toHaveBeenCalledWith('/portal')
    } finally {
      document.cookie = 'taskapp:activeOrgId=; max-age=0'
    }
  })

  it('「アプリへ戻る」はフルページ遷移で着地判定へ（router.push はしない）', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'already@example.com' } } },
    })
    membershipResponse = { data: [{ org_id: 'org-1', role: 'owner' }] }
    spaceResponse = { data: { id: 'space-1' } }

    render(<LoginClient />)
    await screen.findByRole('button', { name: 'アプリへ戻る' })
    fireEvent.click(screen.getByRole('button', { name: 'アプリへ戻る' }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
    })
  })
})

// window.location.assign() は遷移を予約するだけで即座に返るため、成功後に setLoading(false) 等で
// ローディングを解除するとフルページ遷移が終わるまでの間（遅い回線で0.5〜1秒）ボタンが一瞬
// 操作可能に戻り、二重送信（サインイン＋着地判定のやり直し）を招く。ページが破棄されるまで
// ローディング状態を維持し続けることを保証する回帰テスト。
describe('LoginClient — 成功後はページ破棄までローディングを解除しない', () => {
  let membershipResponse: { data: { org_id: string; role: string }[] | null }
  let spaceResponse: { data: { id: string } | null }
  let vendorResponse: { data: { id: string } | null }

  function setupTableMocks() {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'spaces') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn(() => Promise.resolve(spaceResponse)),
        }
      }
      if (table === 'space_memberships') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn(() => Promise.resolve(vendorResponse)),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() => Promise.resolve(membershipResponse)),
      }
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    stubLocationAssign()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    membershipResponse = { data: null }
    spaceResponse = { data: null }
    vendorResponse = { data: null }
    setupTableMocks()
  })

  it('メール+パスワードでのログイン成功後、ボタンはローディング表示のまま（window.location.assign は呼ばれる）', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    render(<LoginClient />)
    fireEvent.change(screen.getByLabelText(/^メールアドレス\*?$/), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(/^パスワード\*?$/), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/onboarding')
    })
    expect(screen.getByText('処理中...')).toBeInTheDocument()
    expect(screen.getByText('処理中...').closest('button')).toBeDisabled()
  })

  it('メール+パスワードでのログイン失敗時は、ボタンのローディングを解除する', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })

    render(<LoginClient />)
    fireEvent.change(screen.getByLabelText(/^メールアドレス\*?$/), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(/^パスワード\*?$/), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(screen.getByText('メールアドレスまたはパスワードが正しくありません')).toBeInTheDocument()
    })
    expect(locationAssignSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })

  it('デモアカウントのクイックログイン成功後も、そのボタンはローディング表示のまま', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    render(<LoginClient />)
    fireEvent.click(screen.getByRole('button', { name: /田中 太郎/ }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/onboarding')
    })
    expect(screen.getByText('ログイン中...')).toBeInTheDocument()
  })

  // iPhone Safari 等が bfcache（swipe back）からこのページをそのまま復元すると、ページは
  // 実際には破棄されておらず、成功直後に維持しているローディングを戻す機会が無いまま
  // ボタンが永久に押せなくなる。pageshow(persisted:true) を検知したら解除する。
  it('メールログイン成功後にbfcacheから復元されたら、ローディングを解除する', async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    render(<LoginClient />)
    fireEvent.change(screen.getByLabelText(/^メールアドレス\*?$/), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText(/^パスワード\*?$/), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/onboarding')
    })
    expect(screen.getByText('処理中...').closest('button')).toBeDisabled()

    const event = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)

    expect(screen.getByRole('button', { name: 'ログイン' })).not.toBeDisabled()
  })

  it('「アプリへ戻る」の成功後も、ボタンはローディング（無効化）のまま', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'already@example.com' } } },
    })
    membershipResponse = { data: [{ org_id: 'org-1', role: 'owner' }] }
    spaceResponse = { data: { id: 'space-1' } }

    render(<LoginClient />)
    const returnButton = await screen.findByRole('button', { name: 'アプリへ戻る' })
    fireEvent.click(returnButton)

    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalledWith('/org-1/project/space-1')
    })
    expect(screen.getByRole('button', { name: 'アプリへ戻る' })).toBeDisabled()
  })
})

describe('LoginClient — redirect パラメータ（招待ログインリンク等）', () => {
  let membershipResponse: { data: { org_id: string; role: string }[] | null }

  beforeEach(() => {
    vi.clearAllMocks()
    stubLocationAssign()
    mockSearchParams = new URLSearchParams()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockSignInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    membershipResponse = { data: null }
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(() => Promise.resolve(membershipResponse)),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({ data: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
    }))
  })

  afterEach(() => {
    mockSearchParams = new URLSearchParams()
  })

  async function login() {
    render(<LoginClient />)
    fireEvent.change(screen.getByLabelText(/^メールアドレス\*?$/), {
      target: { value: 'user@example.com' },
    })
    fireEvent.change(screen.getByLabelText(/^パスワード\*?$/), {
      target: { value: 'password123' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    await waitFor(() => {
      expect(locationAssignSpy).toHaveBeenCalled()
    })
  }

  it('redirect があればパスワードログイン後にそこへ復帰（招待動線）', async () => {
    mockSearchParams = new URLSearchParams('redirect=/invite/tok-1')

    await login()

    expect(locationAssignSpy).toHaveBeenCalledWith('/invite/tok-1')
  })

  it('不正な redirect（// 始まり）は無視して通常の着地判定へ', async () => {
    mockSearchParams = new URLSearchParams('redirect=//evil.com')

    await login()

    expect(locationAssignSpy).toHaveBeenCalledWith('/onboarding')
  })
})

// 旧: 招待メールの本文が /portal/<token> を指していた時期に送られたメールが残っている。
// アカウント未作成の受信者がそのリンクからログイン画面へ飛ばされると、そのままでは
// 招待を受諾できない（「新規登録」を押すと別組織が新規に作られてしまう）ため、
// /invite/<token> への案内を出す。
describe('LoginClient — 旧 /portal/<token> リンクからの案内', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubLocationAssign()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockFrom.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(() => Promise.resolve({ data: null })),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn(() => Promise.resolve({ data: null })),
      maybeSingle: vi.fn(() => Promise.resolve({ data: null })),
    }))
  })

  afterEach(() => {
    mockSearchParams = new URLSearchParams()
  })

  const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

  it('/portal/<uuid> への redirect は招待受諾への案内を出す', () => {
    mockSearchParams = new URLSearchParams(`redirect=/portal/${uuid}`)

    render(<LoginClient />)

    expect(screen.getByText(/招待メールのリンクから来た方/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /こちら/ })).toHaveAttribute(
      'href',
      `/invite/${uuid}`
    )
  })

  it('/vendor-portal/<uuid> への redirect も招待受諾への案内を出す', () => {
    mockSearchParams = new URLSearchParams(`redirect=/vendor-portal/${uuid}`)

    render(<LoginClient />)

    expect(screen.getByText(/招待メールのリンクから来た方/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /こちら/ })).toHaveAttribute(
      'href',
      `/invite/${uuid}`
    )
  })

  it('/portal/files のような固定パスへの redirect では案内を出さない', () => {
    mockSearchParams = new URLSearchParams('redirect=/portal/files')

    render(<LoginClient />)

    expect(screen.queryByText(/招待メールのリンクから来た方/)).not.toBeInTheDocument()
  })

  it('/org/... のような無関係な redirect では案内を出さない', () => {
    mockSearchParams = new URLSearchParams('redirect=/org-1/project/space-1')

    render(<LoginClient />)

    expect(screen.queryByText(/招待メールのリンクから来た方/)).not.toBeInTheDocument()
  })

  it('UUID形式でないトークンでは案内を出さない', () => {
    mockSearchParams = new URLSearchParams('redirect=/portal/not-a-uuid')

    render(<LoginClient />)

    expect(screen.queryByText(/招待メールのリンクから来た方/)).not.toBeInTheDocument()
  })
})
