import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useReminderPreference } from '@/lib/hooks/useReminderPreference'

const mockFrom = vi.fn()
const mockUpsert = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

describe('useReminderPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // upsert (not update) — the profiles row may not exist yet if the
    // on_auth_user_created trigger hasn't run.
    mockFrom.mockReturnValue({ upsert: mockUpsert })
    mockUpsert.mockResolvedValue({ error: null })
  })

  it('starts with the initial value passed in', () => {
    const { result } = renderHook(() => useReminderPreference('user-1', true))
    expect(result.current.enabled).toBe(true)
  })

  it('optimistically flips the value before the server responds', async () => {
    const { result } = renderHook(() => useReminderPreference('user-1', true))

    act(() => {
      void result.current.toggle()
    })

    expect(result.current.enabled).toBe(false)
    await waitFor(() => expect(result.current.saving).toBe(false))
  })

  it('persists the new value to profiles.reminder_emails_enabled for the given user', async () => {
    const { result } = renderHook(() => useReminderPreference('user-1', true))

    await act(async () => {
      await result.current.toggle()
    })

    expect(mockFrom).toHaveBeenCalledWith('profiles')
    expect(mockUpsert).toHaveBeenCalledWith(
      { id: 'user-1', reminder_emails_enabled: false },
      { onConflict: 'id' }
    )
  })

  it('reverts to the previous value when the server update fails', async () => {
    mockUpsert.mockResolvedValue({ error: { message: 'update failed' } })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useReminderPreference('user-1', true))

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.enabled).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
