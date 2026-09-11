import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const replaceMock = vi.fn()
let redirectParam: string | null = '/inbox'
vi.mock('@/lib/auth/resolveLanding', () => ({ resolvePostLoginLanding: vi.fn(() => Promise.resolve('/org-1/project/space-1')) }))
vi.mock('@/lib/org/activeOrg', () => ({ getActiveOrgId: () => null }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === 'redirect' ? redirectParam : null) }),
}))

const mockSignOutAndLeave = vi.fn(() => Promise.resolve())
vi.mock('@/lib/auth/signOutClient', () => ({
  signOutAndLeave: mockSignOutAndLeave,
}))

let factors: Array<{ id: string; status: string }> = [{ id: 'f1', status: 'verified' }]
const challengeAndVerifyMock = vi.fn()
const signOutMock = vi.fn(() => Promise.resolve())
const refreshSessionMock = vi.fn(() => Promise.resolve({ data: {}, error: null }))
let aalAfterRefresh: { currentLevel: 'aal1' | 'aal2'; nextLevel: 'aal1' | 'aal2' } = { currentLevel: 'aal1', nextLevel: 'aal1' }
let listFactorsImpl: () => Promise<unknown> = () => Promise.resolve({ data: { totp: factors, all: factors }, error: null })
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signOut: signOutMock,
      refreshSession: refreshSessionMock,
      mfa: {
        listFactors: () => listFactorsImpl(),
        challengeAndVerify: challengeAndVerifyMock,
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: aalAfterRefresh, error: null }),
      },
    },
  }),
}))

const { default: MfaChallengeClient } = await import('@/app/(auth)/login/mfa/MfaChallengeClient')

let locationReplaceSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  factors = [{ id: 'f1', status: 'verified' }]
  redirectParam = '/inbox'
  aalAfterRefresh = { currentLevel: 'aal1', nextLevel: 'aal1' }
  listFactorsImpl = () => Promise.resolve({ data: { totp: factors, all: factors }, error: null })
  challengeAndVerifyMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  locationReplaceSpy = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { ...window.location, replace: locationReplaceSpy },
    writable: true,
  })
})

describe('MfaChallengeClient（コード入力画面）', () => {
  it('正しいコードで verify し、フルページ遷移で元の行き先へ戻る（全角・空白も整える）', async () => {
    render(<MfaChallengeClient />)
    const input = await screen.findByLabelText('6桁のコード')
    fireEvent.change(input, { target: { value: '１２3 456' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    await waitFor(() => expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: 'f1', code: '123456' }))
    // 識別が変わりうるサインイン完了はフルページ遷移で終える（router.replace はしない）
    await waitFor(() => expect(locationReplaceSpy).toHaveBeenCalledWith('/inbox'))
    expect(replaceMock).not.toHaveBeenCalledWith('/inbox')
  })

  it('行き先の指定が無ければ、ログイン直後と同じ着地判定へ（フルページ遷移）', async () => {
    redirectParam = null
    render(<MfaChallengeClient />)
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    await waitFor(() => expect(locationReplaceSpy).toHaveBeenCalledWith('/org-1/project/space-1'))
  })

  // iPhone Safari 等が bfcache（swipe back）からこのページをそのまま復元すると、ページは
  // 実際には破棄されておらず、verify成功直後に維持している submitting を戻す機会が無いまま
  // ボタンが永久に押せなくなる。pageshow(persisted:true) を検知したら解除する。
  it('verify成功後にbfcacheから復元されたら、確認ボタンのローディングを解除する', async () => {
    render(<MfaChallengeClient />)
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    await waitFor(() => expect(locationReplaceSpy).toHaveBeenCalledWith('/inbox'))
    expect(screen.getByText('確認中…').closest('button')).toBeDisabled()

    const event = new Event('pageshow') as PageTransitionEvent
    Object.defineProperty(event, 'persisted', { value: true })
    fireEvent(window, event)

    expect(screen.getByRole('button', { name: '確認する' })).not.toBeDisabled()
  })

  it('コードが違えばエラー表示、遷移しない', async () => {
    challengeAndVerifyMock.mockResolvedValue({ data: null, error: { message: 'invalid' } })
    render(<MfaChallengeClient />)
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('コードが違います')
    expect(locationReplaceSpy).not.toHaveBeenCalled()
  })

  it('6桁未満は送らない', async () => {
    render(<MfaChallengeClient />)
    fireEvent.change(await screen.findByLabelText('6桁のコード'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('6桁')
    expect(challengeAndVerifyMock).not.toHaveBeenCalled()
  })

  it('登録が無ければ（運営が解除した等）cookie を refreshSession で入れ替えてから行き先へ。外部URLの redirect は無視してトップへ', async () => {
    factors = []
    redirectParam = '//evil.example'
    render(<MfaChallengeClient />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
    expect(refreshSessionMock).toHaveBeenCalledTimes(1)
  })

  it('制御文字入りの redirect（/<TAB>/evil.example）も弾いてトップへ', async () => {
    factors = []
    redirectParam = '/\t/evil.example'
    render(<MfaChallengeClient />)
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'))
  })

  it('refresh しても門番が回してくる状態（登録済み×aal1 のまま）なら signOutAndLeave で /login（無限ループ防止）', async () => {
    factors = []
    aalAfterRefresh = { currentLevel: 'aal1', nextLevel: 'aal2' }
    render(<MfaChallengeClient />)
    await waitFor(() => expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/login', pushCleanup: false }))
  })

  it('factor 一覧の取得が例外なら固まらずエラー表示', async () => {
    listFactorsImpl = () => Promise.reject(new Error('offline'))
    render(<MfaChallengeClient />)
    expect(await screen.findByRole('alert')).toHaveTextContent('取得できませんでした')
  })

  it('「別のアカウントでログイン」で signOutAndLeave({ to: "/login", pushCleanup: false }) を呼ぶ', async () => {
    render(<MfaChallengeClient />)
    fireEvent.click(await screen.findByRole('button', { name: '別のアカウントでログインする' }))
    await waitFor(() => expect(mockSignOutAndLeave).toHaveBeenCalledWith({ to: '/login', pushCleanup: false }))
  })
})
