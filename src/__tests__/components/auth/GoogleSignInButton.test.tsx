import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

/**
 * signInWithOAuth() は Google のアカウント選択画面へリダイレクトするため、成功時はページが
 * 破棄されるまで loading を維持したままにする設計。iPhone Safari で Google のアカウント選択
 * 画面からスワイプで戻ると、このページは bfcache からそのまま復元され、実際には破棄されて
 * おらずボタンが永久にスピナーのままになる。pageshow(persisted:true) を検知したら解除する。
 */

const mockSignInWithOAuth = vi.fn(() => Promise.resolve({ error: null }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signInWithOAuth: mockSignInWithOAuth },
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mockSignInWithOAuth.mockResolvedValue({ error: null })
})

describe('GoogleSignInButton', () => {
  it('クリックするとローディング表示になる', async () => {
    render(<GoogleSignInButton label="Googleでログイン" />)

    fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalled()
    })
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('bfcacheから復元されたら、ローディングを解除する', async () => {
    render(<GoogleSignInButton label="Googleでログイン" />)

    fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalled()
    })
    expect(screen.getByRole('button')).toBeDisabled()

    const event = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)

    expect(screen.getByRole('button')).not.toBeDisabled()
  })

  it('persisted: false（通常の初回読み込み）の pageshow ではローディングを解除しない', async () => {
    render(<GoogleSignInButton label="Googleでログイン" />)

    fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))

    await waitFor(() => {
      expect(mockSignInWithOAuth).toHaveBeenCalled()
    })
    expect(screen.getByRole('button')).toBeDisabled()

    const event = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(event, 'persisted', { value: false })
    fireEvent(window, event)

    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('signInWithOAuth() が例外を投げたら、ローディングを解除する', async () => {
    mockSignInWithOAuth.mockRejectedValue(new Error('network down'))

    render(<GoogleSignInButton label="Googleでログイン" />)
    fireEvent.click(screen.getByRole('button', { name: 'Googleでログイン' }))

    await waitFor(() => {
      expect(screen.getByRole('button')).not.toBeDisabled()
    })
  })
})
