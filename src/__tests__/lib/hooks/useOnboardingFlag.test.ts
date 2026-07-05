import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useOnboardingFlag } from '@/lib/hooks/useOnboardingFlag'

const LOCAL_KEY = 'taskapp_test_onboarded'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateEq = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

describe('useOnboardingFlag', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    // from('profiles').select('onboarding_flags').eq('id', ...).single()
    mockFrom.mockReturnValue({ select: mockSelect, update: mockUpdate })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ single: mockSingle })
    // from('profiles').update({...}).eq('id', ...)
    mockUpdate.mockReturnValue({ eq: mockUpdateEq })
    mockUpdateEq.mockResolvedValue({ error: null })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('short-circuits to shouldShow=false when localStorage already marks it done, without querying the server', async () => {
    localStorage.setItem(LOCAL_KEY, 'true')

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(false)
    })

    expect(mockGetUser).not.toHaveBeenCalled()
  })

  it('returns shouldShow=false when the server flag for the key is true', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSingle.mockResolvedValue({
      data: { onboarding_flags: { internal_walkthrough: true } },
      error: null,
    })

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(false)
    })
  })

  it('returns shouldShow=true when the server flag for the key is absent', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSingle.mockResolvedValue({
      data: { onboarding_flags: { portal_walkthrough: true } },
      error: null,
    })

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true)
    })
  })

  it('falls back to shouldShow=true when the server lookup errors (e.g. column not migrated yet)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSingle.mockResolvedValue({
      data: null,
      error: { message: 'column "onboarding_flags" does not exist' },
    })

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true)
    })
  })

  it('falls back to shouldShow=true when there is no logged-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true)
    })

    expect(mockSingle).not.toHaveBeenCalled()
  })

  it('markDone writes localStorage and merges the key into profiles.onboarding_flags', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSingle.mockResolvedValue({
      data: { onboarding_flags: { portal_walkthrough: true } },
      error: null,
    })

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))

    await waitFor(() => {
      expect(result.current.shouldShow).toBe(true)
    })

    await result.current.markDone()

    expect(localStorage.getItem(LOCAL_KEY)).toBe('true')
    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(mockUpdate).toHaveBeenCalledWith({
      onboarding_flags: { portal_walkthrough: true, internal_walkthrough: true },
    })
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'user-1')
  })

  it('markDone still writes localStorage when the server update fails (swallows the error)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockSingle.mockResolvedValue({ data: { onboarding_flags: {} }, error: null })
    mockUpdateEq.mockResolvedValue({ error: { message: 'update failed' } })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useOnboardingFlag('internal_walkthrough', LOCAL_KEY))
    await waitFor(() => expect(result.current.shouldShow).toBe(true))

    await expect(result.current.markDone()).resolves.toBeUndefined()

    expect(localStorage.getItem(LOCAL_KEY)).toBe('true')
    expect(warnSpy).toHaveBeenCalled()
  })
})
