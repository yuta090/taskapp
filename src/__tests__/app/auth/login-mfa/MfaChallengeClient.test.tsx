import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const replaceMock = vi.fn()
let redirectParam: string | null = '/inbox'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'redirect' ? redirectParam : null) }),
}))

let factors: Array<{ id: string; status: string }> = [{ id: 'f1', status: 'verified' }]
const challengeAndVerifyMock = vi.fn()
const signOutMock = vi.fn(() => Promise.resolve())
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signOut: signOutMock,
      mfa: {
        listFactors: () => Promise.resolve({ data: { totp: factors, all: factors }, error: null }),
        challengeAndVerify: challengeAndVerifyMock,
      },
    },
  }),
}))

const { default: MfaChallengeClient } = await import('@/app/(auth)/login/mfa/MfaChallengeClient')

beforeEach(() => {
  vi.clearAllMocks()
  factors = [{ id: 'f1', status: 'verified' }]
  redirectParam = '/inbox'
  challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null })
})

describe('MfaChallengeClient（コード入力画面）', () => {
  it('正しいコードで verify し、元の行き先へ戻る（全角・空白も整える）', async () => {
    render(<MfaChallengeClient />)
    const input = await screen.findByLabelText('6桁のコード')
    fireEvent.change(input, { target: { value: '１２3 456' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    await waitFor(() => expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' }))
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/inbox'))
  })

  it('コードが違えばエラー表示、遷移しない', async () => {
    challengeAndVerifyMock.mockResolvedValue({ data: null, error: { message: 'invalid' } })
    render(<MfaChallengeClient />)
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('コードが違います')
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('6桁未満は送らない', async () => {
    render(<MfaChallengeClient />)
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('6桁')
    expect(challengeAndVerifyMock).not.toHaveBeenCalled()
  })

  it('登録が無ければ（誤って来た）そのまま行き先へ。外部URLの redirect は無視してトップへ', async () => {
    factors = []
    redirectParam = '//evil.example'
    render(<MfaChallengeClient />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
  })

  it('「別のアカウントでログイン」でサインアウトして /login へ', async () => {
    render(<MfaChallengeClient />)
    fireEvent.click(await screen.findByRole('button', { name: '別のアカウントでログインする' }))
    await waitFor(() => expect(signOutMock).toHaveBeenCalled())
    expect(replaceMock).toHaveBeenCalledWith('/login')
  })
})
