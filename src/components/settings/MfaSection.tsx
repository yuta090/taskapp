'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, CircleNotch } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { TOTP_FRIENDLY_NAME, normalizeTotpCode } from '@/lib/auth/mfa'

type Step = 'loading' | 'off' | 'enrolling' | 'on' | 'disabling'

/**
 * 二要素認証（認証アプリ）の登録・解除。
 * 登録: enroll（QR を表示）→ 認証アプリで読み取り → 6桁コードで verify（この時点で aal2 になる）
 * 解除: Supabase は解除に aal2 を要求するので、いまが aal1 ならコードを1回入れてもらってから unenroll
 * 途中でやめた未確認の factor は次回開いたときに片付ける（未確認のまま残ると再登録できないため）
 */
export function MfaSection() {
  const [step, setStep] = useState<Step>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data, error } = await supabase.auth.mfa.listFactors()
    if (error) {
      setMessage({ type: 'error', text: '二要素認証の状態を取得できませんでした' })
      setStep('off')
      return
    }
    const totp = data?.totp ?? []
    // 途中でやめた未確認の登録は片付ける
    for (const f of (data?.all ?? []).filter((f) => f.status === 'unverified')) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }
    const verified = totp.find((f) => f.status === 'verified')
    setFactorId(verified?.id ?? null)
    setStep(verified ? 'on' : 'off')
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const startEnroll = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const supabase = createClient()
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: TOTP_FRIENDLY_NAME })
      if (error || !data) throw new Error(error?.message || 'enroll failed')
      setFactorId(data.id)
      const raw = data.totp.qr_code
      setQr(raw.startsWith('data:') ? raw : `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`)
      setSecret(data.totp.secret)
      setCode('')
      setStep('enrolling')
    } catch {
      setMessage({ type: 'error', text: '登録を開始できませんでした。しばらくしてからもう一度お試しください。' })
    } finally {
      setBusy(false)
    }
  }, [])

  const cancelEnroll = useCallback(async () => {
    if (factorId) {
      const supabase = createClient()
      await supabase.auth.mfa.unenroll({ factorId })
    }
    setFactorId(null)
    setQr(null)
    setSecret(null)
    setStep('off')
  }, [factorId])

  const confirmEnroll = useCallback(async () => {
    if (!factorId || busy) return
    const normalized = normalizeTotpCode(code)
    if (normalized.length !== 6) {
      setMessage({ type: 'error', text: '6桁のコードを入力してください' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const supabase = createClient()
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId })
      if (cErr || !challenge) throw new Error(cErr?.message || 'challenge failed')
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: normalized })
      if (vErr) {
        setMessage({ type: 'error', text: 'コードが違います。認証アプリの最新の6桁を入力してください。' })
        return
      }
      setQr(null)
      setSecret(null)
      setCode('')
      setStep('on')
      setMessage({ type: 'success', text: '二要素認証を有効にしました。次回のログインからコードの入力が必要になります。' })
    } catch {
      setMessage({ type: 'error', text: '確認に失敗しました。もう一度お試しください。' })
    } finally {
      setBusy(false)
    }
  }, [factorId, code, busy])

  const disable = useCallback(async () => {
    if (!factorId || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const supabase = createClient()
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal?.currentLevel !== 'aal2') {
        // 解除には2段階目を通った状態が要る → コードを入れてもらう
        const normalized = normalizeTotpCode(code)
        if (normalized.length !== 6) {
          setStep('disabling')
          setMessage({ type: 'error', text: '解除するには、認証アプリの6桁コードを入力してください' })
          return
        }
        const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized })
        if (vErr) {
          setMessage({ type: 'error', text: 'コードが違います' })
          return
        }
      }
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) throw new Error(error.message)
      setFactorId(null)
      setCode('')
      setStep('off')
      setMessage({ type: 'success', text: '二要素認証を解除しました' })
    } catch {
      setMessage({ type: 'error', text: '解除に失敗しました。もう一度お試しください。' })
    } finally {
      setBusy(false)
    }
  }, [factorId, code, busy])

  const codeInput = (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      aria-label="6桁のコード"
      value={code}
      onChange={(e) => setCode(e.target.value)}
      placeholder="123456"
      className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm tracking-[0.3em] text-center bg-surface text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
    />
  )

  return (
    <div className="bg-surface rounded-lg border border-gray-200 p-6" data-testid="mfa-section">
      <h3 className="text-sm font-medium text-gray-900 mb-1 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-gray-500" />
        二要素認証（認証アプリ）
      </h3>
      <p className="text-xs text-gray-500 mb-4">
        ログイン時に、パスワードに加えて認証アプリ（Google Authenticator / Microsoft Authenticator / 1Password など）の6桁コードを求めます。
        パスワードが漏れても他人がログインできなくなります。
      </p>

      {step === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-500" role="status">
          <CircleNotch size={16} className="animate-spin" />
          確認しています…
        </div>
      )}

      {step === 'off' && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-gray-700">
            状態: <span className="font-medium text-gray-500">オフ</span>
          </p>
          <button
            type="button"
            onClick={startEnroll}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            有効にする
          </button>
        </div>
      )}

      {step === 'enrolling' && (
        <div className="space-y-4">
          <ol className="text-sm text-gray-700 list-decimal pl-5 space-y-1">
            <li>認証アプリでこの QR コードを読み取ります。</li>
            <li>アプリに表示された6桁のコードを下に入力して「確認する」を押します。</li>
          </ol>
          {qr && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="認証アプリ用のQRコード" width={180} height={180} className="border border-gray-200 rounded-lg bg-white" />
          )}
          {secret && (
            <p className="text-xs text-gray-500">
              QR を読めない場合は、このキーを手で入力してください:{' '}
              <code className="font-mono text-gray-700 break-all">{secret}</code>
            </p>
          )}
          <div className="flex items-center gap-2">
            {codeInput}
            <button
              type="button"
              onClick={confirmEnroll}
              disabled={busy}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {busy ? '確認中…' : '確認する'}
            </button>
            <button type="button" onClick={cancelEnroll} disabled={busy} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
              やめる
            </button>
          </div>
        </div>
      )}

      {(step === 'on' || step === 'disabling') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm text-gray-700">
              状態: <span className="font-medium text-green-600">オン</span>
            </p>
            {step === 'on' && (
              <button
                type="button"
                onClick={disable}
                disabled={busy}
                className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                解除する
              </button>
            )}
          </div>
          {step === 'disabling' && (
            <div className="flex items-center gap-2">
              {codeInput}
              <button
                type="button"
                onClick={disable}
                disabled={busy}
                className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {busy ? '解除中…' : 'コードを確認して解除'}
              </button>
              <button type="button" onClick={() => setStep('on')} className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900">
                やめる
              </button>
            </div>
          )}
        </div>
      )}

      {message && (
        <p className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}
    </div>
  )
}
