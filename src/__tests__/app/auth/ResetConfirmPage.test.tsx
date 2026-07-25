import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import type { Session } from '@supabase/supabase-js'

/**
 * 回帰(Fable裁定・論点3): リカバリトークンは非同期処理のため、
 * mount 時 getSession が null を返しても、その後の PASSWORD_RECOVERY 発火で
 * フォームが表示されなければならない（一発 getSession 判定では誤って「無効」になっていた）。
 */

let authCallback: ((event: string, session: Session | null) => void) | null = null
const getSessionMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string, session: Session | null) => void) => {
        authCallback = cb
        return { data: { subscription: { unsubscribe: vi.fn() } } }
      },
      getSession: () => getSessionMock(),
      updateUser: vi.fn(),
    },
  }),
}))

import ResetConfirmPage from '@/app/(auth)/reset/confirm/page'

beforeEach(() => {
  vi.clearAllMocks()
  authCallback = null
  window.location.hash = ''
})

describe('ResetConfirmPage', () => {
  it('getSession が null でも、後から PASSWORD_RECOVERY が発火すればフォームを表示する', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })

    render(<ResetConfirmPage />)

    // 初期は確認中（まだ「無効」を出さない）
    expect(screen.queryByText('リンクが無効です')).not.toBeInTheDocument()

    // トークン処理完了イベントが遅れて発火
    await act(async () => {
      authCallback?.('PASSWORD_RECOVERY', { user: { id: 'u1' } } as unknown as Session)
    })

    await waitFor(() =>
      expect(screen.getByText('新しいパスワードを設定')).toBeInTheDocument()
    )
    expect(screen.queryByText('リンクが無効です')).not.toBeInTheDocument()
  })

  it('URLハッシュに otp_expired があれば待たずに「無効」を表示する', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } })
    window.location.hash = '#error_code=otp_expired'

    render(<ResetConfirmPage />)

    await waitFor(() =>
      expect(screen.getByText('リンクが無効です')).toBeInTheDocument()
    )
  })
})
