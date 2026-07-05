import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import LoginClient from '@/app/(auth)/login/LoginClient'

const mockPush = vi.fn()
let mockSearchParams = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/login',
}))

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
    auth: {
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
      expect(mockPush).toHaveBeenCalled()
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
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
    expect(mockPush).toHaveBeenCalledWith('/onboarding')
  })

  it('組織はあるがプロジェクトが無ければ /onboarding へ（Step2から再開）', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'owner' }] }
    spaceResponse = { data: null }
    await login()
    expect(mockPush).toHaveBeenCalledWith('/onboarding')
  })

  it('組織もプロジェクトもあれば最初のプロジェクトへ', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'owner' }] }
    spaceResponse = { data: { id: 'space-1' } }
    await login()
    expect(mockPush).toHaveBeenCalledWith('/org-1/project/space-1')
  })

  it('clientロールは /portal へ', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'client' }] }
    await login()
    expect(mockPush).toHaveBeenCalledWith('/portal')
  })

  it('clientロールでも同org内にvendorのspace所属があれば /vendor-portal へ', async () => {
    membershipResponse = { data: [{ org_id: 'org-1', role: 'client' }] }
    vendorResponse = { data: { id: 'sm-1' } }
    await login()
    expect(mockPush).toHaveBeenCalledWith('/vendor-portal')
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
      expect(mockPush).toHaveBeenCalledWith('/portal')
    } finally {
      document.cookie = 'taskapp:activeOrgId=; max-age=0'
    }
  })
})

describe('LoginClient — redirect パラメータ（招待ログインリンク等）', () => {
  let membershipResponse: { data: { org_id: string; role: string }[] | null }

  beforeEach(() => {
    vi.clearAllMocks()
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
      expect(mockPush).toHaveBeenCalled()
    })
  }

  it('redirect があればパスワードログイン後にそこへ復帰（招待動線）', async () => {
    mockSearchParams = new URLSearchParams('redirect=/invite/tok-1')

    await login()

    expect(mockPush).toHaveBeenCalledWith('/invite/tok-1')
  })

  it('不正な redirect（// 始まり）は無視して通常の着地判定へ', async () => {
    mockSearchParams = new URLSearchParams('redirect=//evil.com')

    await login()

    expect(mockPush).toHaveBeenCalledWith('/onboarding')
  })
})
