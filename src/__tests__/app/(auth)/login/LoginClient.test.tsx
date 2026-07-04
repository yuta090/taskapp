import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import LoginClient from '@/app/(auth)/login/LoginClient'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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
