import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import OnboardingPage from '@/app/(auth)/onboarding/page'

const mockPush = vi.fn()
const mockReplace = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/onboarding',
}))

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockLimit = vi.fn()
const mockMaybeSingle = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: vi.fn(),
  }),
}))

describe('OnboardingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ limit: mockLimit })
    mockLimit.mockReturnValue({ maybeSingle: mockMaybeSingle })
    mockMaybeSingle.mockResolvedValue({ data: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should prefill the org name from user_metadata.org_name', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: { org_name: '株式会社サンプル' } } },
    })

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('株式会社サンプル')
    })
  })

  it('should show the prefill-specific description when org_name is available', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: { org_name: '株式会社サンプル' } } },
    })

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByText('登録時の組織名を確認して開始してください。')).toBeInTheDocument()
    })
  })

  it('should keep the default description when org_name is not available', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: {} } },
    })

    render(<OnboardingPage />)

    await waitFor(() => {
      expect(screen.getByText('あと少しで完了です。組織名を入力してください。')).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/^組織名\*?$/)).toHaveValue('')
  })
})
