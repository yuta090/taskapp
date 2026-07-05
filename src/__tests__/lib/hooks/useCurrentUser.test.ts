import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { AuthSessionMissingError } from '@supabase/supabase-js'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'

const mockGetUser = vi.fn()
const mockOnAuthStateChange = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
      onAuthStateChange: mockOnAuthStateChange,
    },
  }),
}))

describe('useCurrentUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateCachedUser()
    mockOnAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should not log a console error when there is no session (AuthSessionMissingError)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    })

    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.user).toBe(null)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('should still log a console error for unexpected auth errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: new Error('network down'),
    })

    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('ユーザー情報の取得に失敗しました')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('should set the user when getUser succeeds', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'a@example.com' } },
      error: null,
    })

    const { result } = renderHook(() => useCurrentUser())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.user?.id).toBe('user-1')
    expect(result.current.error).toBe(null)
  })
})
