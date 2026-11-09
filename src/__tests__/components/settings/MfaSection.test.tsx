import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let factors: Array<{ id: string; status: string; factor_type: string; friendly_name?: string; created_at?: string }> = []
let aal: { currentLevel: 'aal1' | 'aal2'; nextLevel: 'aal1' | 'aal2' } = { currentLevel: 'aal1', nextLevel: 'aal1' }
const enrollMock = vi.fn()
const challengeMock = vi.fn()
const verifyMock = vi.fn()
const unenrollMock = vi.fn()
const challengeAndVerifyMock = vi.fn()
const registerMock = vi.fn()
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
        webauthn: { register: registerMock },
      },
    },
  }),
}))

const { MfaSection } = await import('@/components/settings/MfaSection')

beforeEach(() => {
  vi.clearAllMocks()
  factors = []
  aal = { currentLevel: 'aal1', nextLevel: 'aal1' }
  enrollMock.mockResolvedValue({ data: { id: 'f-new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg id="a">#</svg>', secret: 'ABCD1234' } }, error: null })
  challengeMock.mockResolvedValue({ data: { id: 'c1' }, error: null })
  verifyMock.mockResolvedValue({ data: {}, error: null })
  unenrollMock.mockResolvedValue({ data: {}, error: null })
  challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null })
  registerMock.mockResolvedValue({ data: {}, error: null })
  ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = function PublicKeyCredential() {}
})

describe('MfaSection（設定画面の二要素認証）', () => {
  it('未登録: 「有効にする」→ QR と手入力キーを表示 → コード確認で有効に', async () => {
    render(<MfaSection />)
    fireEvent.click(await screen.findByRole('button', { name: '有効にする' }))
    // supabase-js が返す未エンコードの data URI を、# で切れないよう再エンコードして描く
    expect(await screen.findByAltText('認証アプリ用のQRコード')).toHaveAttribute('src', `data:image/svg+xml;utf8,${encodeURIComponent('<svg id="a">#</svg>')}`)
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

  it('前回の未確認 TOTP factor は開いたときに片付ける（他種別は触らない）', async () => {
    factors = [{ id: 'stale', status: 'unverified', factor_type: 'totp' }, { id: 'phone1', status: 'unverified', factor_type: 'phone' }]
    render(<MfaSection />)
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'stale' }))
    expect(unenrollMock).not.toHaveBeenCalledWith({ factorId: 'phone1' })
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

  it('登録済みだが aal1: コード入力を求めてから解除（案内は赤いエラーではなく中立表示）', async () => {
    factors = [{ id: 'f1', status: 'verified', factor_type: 'totp' }]
    aal = { currentLevel: 'aal1', nextLevel: 'aal2' }
    render(<MfaSection />)
    fireEvent.click(await screen.findByRole('button', { name: '解除する' }))
    expect(await screen.findByRole('status')).toHaveTextContent('6桁コード')
    expect(unenrollMock).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('6桁のコード'), { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認して解除' }))
    await waitFor(() => expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: 'f1', code: '654321' }))
    await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'f1' }))
  })

  describe('パスキー', () => {
    const totp = { id: 'f1', status: 'verified', factor_type: 'totp' }
    const passkey = { id: 'w1', status: 'verified', factor_type: 'webauthn', friendly_name: 'パスキー 2026/11/10 09:00:00', created_at: '2026-11-10T00:00:00Z' }

    it('認証アプリが未登録なら、パスキーは追加できない', async () => {
      render(<MfaSection />)
      await screen.findByText('オフ')
      expect(screen.queryByRole('button', { name: 'パスキーを追加' })).not.toBeInTheDocument()
    })

    it('認証アプリ登録済み: 「パスキーを追加」で register し、一覧に出す', async () => {
      factors = [totp]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      registerMock.mockImplementation(async () => {
        factors = [totp, passkey]
        return { data: {}, error: null }
      })
      render(<MfaSection />)
      fireEvent.click(await screen.findByRole('button', { name: 'パスキーを追加' }))
      await waitFor(() => expect(registerMock).toHaveBeenCalledTimes(1))
      expect(registerMock.mock.calls[0][0].friendlyName).toMatch(/^パスキー \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
      expect(await screen.findByText('パスキー 2026/11/10 09:00:00')).toBeInTheDocument()
      expect(await screen.findByRole('status')).toHaveTextContent('パスキーを追加しました')
    })

    it('登録をやめた・失敗したら、残った未確認のパスキーを消してエラーを出す', async () => {
      factors = [totp]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      registerMock.mockImplementation(async () => {
        factors = [totp, { id: 'w-half', status: 'unverified', factor_type: 'webauthn' }]
        return { data: null, error: { name: 'WebAuthnError', message: 'NotAllowedError' } }
      })
      render(<MfaSection />)
      fireEvent.click(await screen.findByRole('button', { name: 'パスキーを追加' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('パスキーを追加できませんでした')
      await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'w-half' }))
      expect(unenrollMock).not.toHaveBeenCalledWith({ factorId: 'f1' })
    })

    it('前回の未確認パスキーも開いたときに片付ける', async () => {
      factors = [totp, { id: 'w-stale', status: 'unverified', factor_type: 'webauthn' }]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      render(<MfaSection />)
      await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'w-stale' }))
    })

    it('登録済みのパスキーを1つずつ削除できる', async () => {
      factors = [totp, passkey]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      render(<MfaSection />)
      fireEvent.click(await screen.findByRole('button', { name: 'パスキー 2026/11/10 09:00:00 を削除' }))
      await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'w1' }))
      expect(unenrollMock).not.toHaveBeenCalledWith({ factorId: 'f1' })
      await waitFor(() => expect(screen.queryByText('パスキー 2026/11/10 09:00:00')).not.toBeInTheDocument())
    })

    it('認証アプリを解除するときは、パスキーを先に全部消す（パスキーだけ残るとスマホアプリで入れない）', async () => {
      factors = [totp, passkey]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      render(<MfaSection />)
      fireEvent.click(await screen.findByRole('button', { name: '解除する' }))
      await waitFor(() => expect(unenrollMock).toHaveBeenCalledWith({ factorId: 'f1' }))
      expect(unenrollMock.mock.calls.map((c) => c[0].factorId)).toEqual(['w1', 'f1'])
      expect(await screen.findByText('オフ')).toBeInTheDocument()
    })

    it('パスキーの削除に失敗したら、認証アプリは解除しない', async () => {
      factors = [totp, passkey]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      unenrollMock.mockImplementation(async ({ factorId }: { factorId: string }) =>
        factorId === 'w1' ? { data: null, error: { message: 'boom' } } : { data: {}, error: null },
      )
      render(<MfaSection />)
      fireEvent.click(await screen.findByRole('button', { name: '解除する' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('解除に失敗しました')
      expect(unenrollMock).not.toHaveBeenCalledWith({ factorId: 'f1' })
    })

    it('パスキーに対応していないブラウザでは追加ボタンの代わりに案内を出す', async () => {
      factors = [totp]
      aal = { currentLevel: 'aal2', nextLevel: 'aal2' }
      ;(window as { PublicKeyCredential?: unknown }).PublicKeyCredential = undefined
      render(<MfaSection />)
      expect(await screen.findByText(/このブラウザはパスキーに対応していません/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'パスキーを追加' })).not.toBeInTheDocument()
    })
  })
})
