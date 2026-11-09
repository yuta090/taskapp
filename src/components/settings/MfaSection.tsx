'use client'

import { useCallback, useEffect, useState } from 'react'
import { ShieldCheck, CircleNotch, Fingerprint } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { TOTP_FRIENDLY_NAME, normalizeTotpCode } from '@/lib/auth/mfa'
import { PASSKEY_CREATION_OPTIONS, hasVerifiedTotp, passkeyFriendlyName, verifiedPasskeys, withMfaLock } from '@/lib/auth/passkey'
import { usePasskeySupported } from '@/lib/auth/usePasskeySupported'

type Step = 'loading' | 'off' | 'enrolling' | 'on' | 'disabling'
type Passkey = { id: string; friendly_name?: string; created_at?: string }

type MfaClient = ReturnType<typeof createClient>

/** まとめて消す（片付け用。失敗は記録だけして続ける） */
async function unenrollAll(supabase: MfaClient, factors: ReadonlyArray<{ id: string }>): Promise<void> {
  await Promise.all(
    factors.map(async (f) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: f.id })
      if (error) console.error('[mfa] cleanup unenroll failed', error.message)
    }),
  )
}

/** 途中でやめた未確認の factor（認証アプリ・パスキー）。電話番号など他の種類は触らない */
function isStaleFactor(f: { factor_type: string; status: string }): boolean {
  return (f.factor_type === 'totp' || f.factor_type === 'webauthn') && f.status === 'unverified'
}

/**
 * 二要素認証（認証アプリ）の登録・解除。
 * 登録: enroll（QR を表示）→ 認証アプリで読み取り → 6桁コードで verify（この時点で aal2 になる）
 * 解除: Supabase は解除に aal2 を要求するので、いまが aal1 ならコードを1回入れてもらってから unenroll
 * 途中でやめた未確認の factor は次回開いたときに片付ける（未確認のまま残ると再登録できないため）
 * パスキー: 認証アプリを登録済みの人だけ追加できる。認証アプリを解除するときはパスキーも先に全部消す
 * （スマホアプリはパスキーを使えないので、パスキーだけ残るとアプリでログインできなくなる）。方針は src/lib/auth/passkey.ts
 */
export function MfaSection() {
  const [step, setStep] = useState<Step>('loading')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  // コード入力を待っている削除対象のパスキー
  const [removingId, setRemovingId] = useState<string | null>(null)
  const passkeyAvailable = usePasskeySupported()

  const load = useCallback(async () => {
    try {
      const supabase = createClient()
      // 一覧の取得から片付けまでをロックの中で行う。外で取った一覧で片付けると、
      // 別タブで登録の途中（端末の確認待ち）の未確認パスキーを消してしまう
      const { data, error } = await withMfaLock(async () => {
        const res = await supabase.auth.mfa.listFactors()
        if (!res.error) {
          // 途中でやめた未確認の登録は片付ける（他種別・登録中のものは触らない）
          await unenrollAll(
            supabase,
            (res.data?.all ?? []).filter((f) => isStaleFactor(f) && f.id !== factorId),
          )
        }
        return res
      })
      if (error) {
        setMessage({ type: 'error', text: '二要素認証の状態を取得できませんでした' })
        setStep('off')
        return
      }
      const totp = data?.totp ?? []
      const verified = totp.find((f) => f.status === 'verified')
      setPasskeys(verifiedPasskeys(data?.all ?? []))
      setFactorId(verified?.id ?? null)
      setStep(verified ? 'on' : 'off')
    } catch (err) {
      // 例外（通信断・想定外の応答）でも画面全体を落とさない
      console.error('[mfa] load failed', err instanceof Error ? err.message : err)
      setMessage({ type: 'error', text: '二要素認証の状態を取得できませんでした' })
      setStep('off')
    }
    // 登録中の factorId を除外するため依存に含めない（初回だけ実行）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const addPasskey = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setMessage(null)
    const supabase = createClient()
    try {
      // 同じブラウザの別タブと、追加・削除・解除が交差しないよう1つずつ行う
      await withMfaLock(async () => {
        // 押した時点の一覧で確かめる（別タブで認証アプリを解除していたら、パスキーだけが残る状態になる）
        const { data: before, error: beforeError } = await supabase.auth.mfa.listFactors()
        if (beforeError) throw new Error(beforeError.message)
        if (!hasVerifiedTotp(before?.all ?? [])) {
          setMessage({ type: 'error', text: '先に認証アプリを登録してください。画面を再読み込みしてください。' })
          return
        }
        // 前に途中でやめた未確認の登録が残っていると、登録数の上限に近づくので先に消す
        await unenrollAll(supabase, (before?.all ?? []).filter((f) => f.factor_type === 'webauthn' && f.status === 'unverified'))
        // 登録・確認・端末への作成を1回で行う（rpId は今のホスト名＝本番は agentpm.app）
        const { error } = await supabase.auth.mfa.webauthn.register({ friendlyName: passkeyFriendlyName(new Date()) }, PASSKEY_CREATION_OPTIONS)
        const { data, error: afterError } = await supabase.auth.mfa.listFactors()
        const all = data?.all ?? []
        if (error) {
          // 端末の確認をやめると、Supabase 側に未確認の factor が残る。残すと次の登録の邪魔になるので消す
          await unenrollAll(supabase, all.filter((x) => x.factor_type === 'webauthn' && x.status === 'unverified'))
          setMessage({ type: 'error', text: 'パスキーを追加できませんでした。端末の確認をやめた場合は、もう一度お試しください。' })
          return
        }
        if (!afterError && !hasVerifiedTotp(all)) {
          // 登録している間に別タブで認証アプリが解除された。パスキーだけ残さないよう、今足した分を消して戻す
          // （新しいパスキーで2段階目を通ったセッションなので、消す権限はある）
          const beforeIds = new Set((before?.all ?? []).map((f) => f.id))
          const added = all.filter((f) => f.factor_type === 'webauthn' && !beforeIds.has(f.id))
          const results = await Promise.all(added.map((f) => supabase.auth.mfa.unenroll({ factorId: f.id })))
          if (results.some((r) => r.error)) {
            setMessage({
              type: 'error',
              text: '認証アプリの登録が見つからないため、パスキーの追加を取り消そうとしましたが、取り消せませんでした。画面を再読み込みし、「有効にする」から認証アプリを登録し直してください（スマホアプリでのログインに必要です）。',
            })
            return
          }
          setMessage({ type: 'error', text: '認証アプリの登録が見つからないため、パスキーの追加を取り消しました。画面を再読み込みしてください。' })
          return
        }
        // 一覧を取り直せなかったときは、表示を空にせず前のまま残す（解除はその場で一覧を取り直すので影響しない）
        if (!afterError) setPasskeys(verifiedPasskeys(all))
        setMessage({ type: 'success', text: 'パスキーを追加しました。次回のログインから、6桁コードの代わりにパスキーで確認できます。' })
      })
    } catch {
      setMessage({ type: 'error', text: 'パスキーを追加できませんでした。もう一度お試しください。' })
    } finally {
      setBusy(false)
    }
  }, [busy])

  const askRemovePasskey = useCallback((id: string) => {
    setRemovingId(id)
    setCode('')
    setMessage({ type: 'info', text: '削除するには、認証アプリの6桁コードを入力してください' })
  }, [])

  // 消す前に必ず認証アプリのコードで入り直す。そのパスキーで2段階目を通ったセッションのまま消すと
  // aal1 に下がり、続く操作が権限不足で失敗する。入り直すとセッションが認証アプリに結びつき下がらない
  const confirmRemovePasskey = useCallback(async () => {
    if (!removingId || !factorId || busy) return
    const normalized = normalizeTotpCode(code)
    if (normalized.length !== 6) {
      setMessage({ type: 'error', text: '6桁のコードを入力してください' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      // 同じブラウザの別タブと、追加・削除・解除が交差しないよう1つずつ行う
      await withMfaLock(async () => {
        const supabase = createClient()
        const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized })
        if (vErr) {
          setMessage({ type: 'error', text: 'コードが違います' })
          return
        }
        const { error } = await supabase.auth.mfa.unenroll({ factorId: removingId })
        if (error) throw new Error(error.message)
        setPasskeys((prev) => prev.filter((p) => p.id !== removingId))
        setRemovingId(null)
        setCode('')
        setMessage({ type: 'success', text: 'パスキーを削除しました' })
      })
    } catch {
      setMessage({ type: 'error', text: 'パスキーを削除できませんでした。もう一度お試しください。' })
    } finally {
      setBusy(false)
    }
  }, [removingId, factorId, code, busy])

  const startEnroll = useCallback(async () => {
    setBusy(true)
    setMessage(null)
    try {
      const supabase = createClient()
      // friendly_name は同一ユーザー内で一意でないと enroll が失敗するので時刻を足す
      const friendlyName = `${TOTP_FRIENDLY_NAME} ${new Date().toLocaleDateString('ja-JP')}`
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName })
      if (error || !data) throw new Error(error?.message || 'enroll failed')
      setFactorId(data.id)
      // supabase-js は `data:image/svg+xml;utf-8,<svg…>`（中身は未エンコード）で返す。`#` 等で切れないよう常に再エンコードする
      const raw = data.totp.qr_code
      const payload = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw
      setQr(`data:image/svg+xml;utf8,${encodeURIComponent(payload)}`)
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
      const { error } = await supabase.auth.mfa.unenroll({ factorId })
      if (error) setMessage({ type: 'error', text: '登録の取り消しに失敗しました。画面を再読み込みしてください。' })
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
      // 同じブラウザの別タブと、追加・削除・解除が交差しないよう1つずつ行う
      await withMfaLock(async () => {
        const supabase = createClient()
        // 消す対象は押した時点の一覧で決める（開いたあと別タブで足したパスキーも残さない）。取れなければ何も消さない
        const { data: list, error: listError } = await supabase.auth.mfa.listFactors()
        if (listError) throw new Error(listError.message)
        const keys = (list?.all ?? []).filter((f) => f.factor_type === 'webauthn')
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        // 解除には2段階目を通った状態が要る。パスキーがあるときは aal2 でも必ず認証アプリのコードで入り直す:
        // パスキーで2段階目を通ったセッションは、そのパスキーを消すと aal1 に下がり、続く削除が権限不足で失敗する。
        // 認証アプリで入り直すとセッションが認証アプリに結びつくので、パスキーを消しても下がらない
        if (keys.length > 0 || aal?.currentLevel !== 'aal2') {
          const normalized = normalizeTotpCode(code)
          if (normalized.length !== 6) {
            setStep('disabling')
            setMessage({
              type: 'info',
              text: keys.length > 0 ? '解除するには、認証アプリの6桁コードを入力してください（パスキーも一緒に削除します）' : '解除するには、認証アプリの6桁コードを入力してください',
            })
            return
          }
          const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized })
          if (vErr) {
            setMessage({ type: 'error', text: 'コードが違います' })
            return
          }
        }
        // パスキーを先に消す（パスキーだけ残るとスマホアプリでログインできない）。1つでも失敗したら認証アプリは残す
        // 1件ずつ消し、消せた分は表示からも外す（途中で失敗しても、もう一度押せば残りから続く）
        for (const k of keys) {
          const { error: pkError } = await supabase.auth.mfa.unenroll({ factorId: k.id })
          if (pkError) throw new Error(pkError.message)
          setPasskeys((prev) => prev.filter((p) => p.id !== k.id))
        }
        const { error } = await supabase.auth.mfa.unenroll({ factorId })
        if (error) throw new Error(error.message)
        setFactorId(null)
        setCode('')
        setStep('off')
        setMessage({ type: 'success', text: keys.some((k) => k.status === 'verified') ? '二要素認証を解除しました（パスキーも削除しました）' : '二要素認証を解除しました' })
      })
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
        画面へのログインに、もう1つの確認を挟みます（パスワードだけでは入れなくなります）。
      </p>

      {step === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-gray-500" role="status">
          <CircleNotch size={16} className="animate-spin" />
          確認しています…
        </div>
      )}

      {step === 'off' && passkeys.length > 0 && (
        // 別タブでの同時操作などで、パスキーだけが残った状態。スマホアプリはパスキーを使えないので認証アプリを登録し直してもらう
        <p className="mb-3 text-sm text-red-600" role="note">
          パスキーだけが登録されています。スマホアプリでログインするには認証アプリが要るので、「有効にする」から認証アプリを登録し直してください。
        </p>
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
            <img src={qr} alt="認証アプリ用のQRコード" width={180} height={180} className="border border-gray-200 rounded-lg bg-surface" />
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
          {step === 'on' && (
            <div className="mt-4 pt-4 border-t border-gray-100" data-testid="passkey-section">
              <p className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <Fingerprint className="w-4 h-4 text-gray-500" />
                パスキー
              </p>
              <p className="text-xs text-gray-500 mt-1 mb-3">
                パソコンやスマホの指紋・顔認証、画面ロック、セキュリティキーで確認できます。ログイン時の6桁コードの代わりに使えます。
                スマホアプリでは使えないため、認証アプリの登録はそのまま残ります。
              </p>
              {passkeys.length > 0 && (
                <ul className="mb-3 divide-y divide-gray-100 border border-gray-200 rounded-lg">
                  {passkeys.map((p) => {
                    const name = p.friendly_name || 'パスキー'
                    return (
                      <li key={p.id} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-gray-700 truncate">{name}</span>
                          {removingId !== p.id && (
                            <button
                              type="button"
                              onClick={() => askRemovePasskey(p.id)}
                              disabled={busy}
                              aria-label={`${name} を削除`}
                              className="shrink-0 px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-50 transition-colors"
                            >
                              削除
                            </button>
                          )}
                        </div>
                        {removingId === p.id && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {codeInput}
                            <button
                              type="button"
                              onClick={confirmRemovePasskey}
                              disabled={busy}
                              className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                            >
                              {busy ? '削除中…' : 'コードを確認して削除'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRemovingId(null)
                                setMessage(null)
                              }}
                              className="px-3 py-2 text-sm text-gray-600 hover:text-gray-900"
                            >
                              やめる
                            </button>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {passkeyAvailable ? (
                <button
                  type="button"
                  onClick={addPasskey}
                  disabled={busy}
                  className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  パスキーを追加
                </button>
              ) : (
                <p className="text-xs text-gray-500">このブラウザはパスキーに対応していません。Chrome・Safari・Edge の最新版でお試しください。</p>
              )}
            </div>
          )}
        </div>
      )}

      {message && (
        <p
          className={`mt-3 text-sm ${message.type === 'success' ? 'text-green-600' : message.type === 'info' ? 'text-gray-700' : 'text-red-600'}`}
          role={message.type === 'error' ? 'alert' : 'status'}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
