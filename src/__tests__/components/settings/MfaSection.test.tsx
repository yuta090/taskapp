import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let factors: Array<{ id: string; status: string; factor_type: string }> = []
let aal: { currentLevel: 'aal1' | 'aal2'; nextLevel: 'aal1' | 'aal2' } = { currentLevel: 'aal1', nextLevel: 'aal1' }
const enrollMock = vi.fn()
const challengeMock = vi.fn()
const verifyMock = vi.fn()
const unenrollMock = vi.fn()
const challengeAndVerifyMock = vi.fn()
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      mfa: {
        listFactors: () => Promise.resolve({ data: { totp: factors.filter((f) => f.factor_type === 'totp'), all: factors }, error: null }),
        enroll: enrollMock,
        challenge: challengeMock,
        verify: verifyMock,
        unenroll: unenrollMock,
        challengeAndVerify: challengeAndVerifyMock,
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: aal, error: null }),
      },
    },
  }),
}))

const { MfaSection } = await import('@/components/settings/MfaSection')

beforeEach(() => {
  vi.clearAllMocks()
  factors = []
  aal = { currentLevel: 'aal1', nextLevel: 'aal1' }
  enrollMock.mockResolvedValue({ data: { id: 'f-new', totp: { qr_code: '<svg/>', secret: 'ABCD1234' } }, error: null })
  challengeMock.mockResolvedValue({ data: { id: 'c1' }, error: null })
  verifyMock.mockResolvedValue({ data: {}, error: null })
  unenrollMock.mockResolvedValue({ data: {}, error: null })
  challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null })
})

describe('MfaSection（設定画面の二要素認証）', () => {
  it('未登録: 「有効にする」→ QR と手入力キーを表示 → コード確認で有効に', async () => {
    render(<MfaSection />)
    fireEvent.click(await screen.findByRole('button', { name: '有効にする' }))
    expect(await screen.findByAltText('認証アプリ用のQRコード')).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'))
    expect(screen.getByText('ABCD1234')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('6桁のコード'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '確認する' }))
    await waitFor(() => expect(verifyMock).toHaveBeenCalledWith({ factorId: 'f-new', challengeId: 'c1', code: '123456' }))
    expect(await screen.findByText('オン')).toBeInTheDocument()
  })

  it('登録の途中でやめたら未確認の factor を消す', async () => {
    render(<MfaSection />)
    fireEvent.click(await screen.findByRole('button', { name: '有効にする' }))
    fireEvent.click(await screen.findByRole('button', { name: 'やめる' }))
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'f-new' }))
    expect(await screen.findByText('オフ')).toBeInTheDocument()
  })

  it('前回の未確認 factor は開いたときに片付ける', async () => {
    factors = [{ id: 'stale', status: 'unverified', factor_type: 'totp' }]
    render(<MfaSection />)
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'stale' }))
    expect(await screen.findByText('オフ')).toBeInTheDocument()
  })

  it('登録済み(aal2): 「解除する」で unenroll', async () => {
    factors = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
    render(<MfaSection />)
    fireEvent.click(await screen.findByRole('button', { name: '解除する' }))
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'f1' }))
    expect(challengeAndVerifyMock).not.toHaveBeenCalled()
    expect(await screen.findByText('オフ')).toBeInTheDocument()
  })

  it('登録済みだが aal1: コード入力を求めてから解除', async () => {
    factors = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    aal = { currentLevel: 'aal1', nextLevel: 'aal2' }
    render(<MfaSection />)
    fireEvent.click(await screen.findByRole('button', { name: '解除する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('6桁コード')
    expect(unenrollMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('6桁のコード'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認して解除' }))
    await waitFor(() => expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: 'f1', code: '654321' }))
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'f1' }))
  })
})
