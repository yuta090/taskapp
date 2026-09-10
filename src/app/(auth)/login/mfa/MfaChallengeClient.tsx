'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldCheck, CircleNotch } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { signOutAndLeave } from '@/lib/auth/signOutClient'
import { normalizeTotpCode } from '@/lib/auth/mfa'
import { isSafeInternalPath, safeInternalPathOr } from '@/lib/auth/safeRedirect'
import { resolvePostLoginLanding } from '@/lib/auth/resolveLanding'
import { getActiveOrgId } from '@/lib/org/activeOrg'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 二要素認証のコード入力。
 * 1) 登録済みの認証アプリ（verified な TOTP factor）を探す → 2) challengeAndVerify → 3) 元の行き先へ。
 * 登録が無い（誤って来た）場合はトップへ返す。
 */
export default function MfaChallengeClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    let alive = true
    ;(async () => {
      try {
        const { data, error: listError } = await supabase.auth.mfa.listFactors()
        if (!alive) return
        if (listError) {
          setError('二要素認証の情報を取得できませんでした。もう一度ログインしてください。')
          setLoading(false)
          return
        }
        const totp = (data?.totp ?? []).find((f) => f.status === 'verified')
        if (!totp) {
          // 登録が無いのにここへ来た = cookie の factor 情報が古い（運営が解除した／別端末で解除した）。
          // getUser/listFactors は cookie を書き戻さないので、refreshSession で入れ替えてから戻す
          // （戻さないと門番との往復ループになる）。それでも門番が回してくるなら諦めてログアウト
          await supabase.auth.refreshSession()
          const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
          if (!alive) return
          if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
            await signOutAndLeave({ to: '/login', pushCleanup: false })
            return
          }
          router.replace(safeInternalPathOr(redirect))
          return
        }
        setFactorId(totp.id)
        setLoading(false)
      } catch {
        if (!alive) return
        setError('二要素認証の情報を取得できませんでした。通信状態を確認してもう一度お試しください。')
        setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [router, redirect])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!factorId || submitting) return
      const normalized = normalizeTotpCode(code)
      if (normalized.length !== 6) {
        setError('6桁のコードを入力してください')
        return
      }
      setSubmitting(true)
      setError(null)
      try {
        const supabase = createClient()
        const { data: verified, error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized })
        if (verifyError) {
          setError('コードが違います。認証アプリに表示されている最新の6桁を入力してください。')
          setSubmitting(false)
          return
        }
        // 行き先の指定が無ければ、ログイン直後と同じ着地判定（コード入力後なので組織情報が読める）
        // 識別が変わりうるサインイン完了はフルページ遷移で終える（ルート常駐のクライアント状態が
        // 前のユーザーのものを引きずらないようにするため。router.replace はしない）
        if (isSafeInternalPath(redirect)) {
          window.location.replace(redirect)
        } else {
          const userId = verified?.user?.id
          window.location.replace(userId ? await resolvePostLoginLanding(supabase as SupabaseClient, userId, { preferredOrgId: getActiveOrgId() }) : '/')
        }
      } catch {
        setError('確認に失敗しました。しばらくしてからもう一度お試しください。')
        setSubmitting(false)
      }
    },
    [factorId, code, submitting, redirect],
  )

  const handleSignOut = useCallback(async () => {
    await signOutAndLeave({ to: '/login', pushCleanup: false })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-surface rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center">
            <ShieldCheck size={20} className="text-indigo-600" />
          </div>
          <h1 className="text-base font-semibold text-gray-900">二要素認証</h1>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500" role="status">
            <CircleNotch size={16} className="animate-spin" />
            確認しています…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">認証アプリ（Google Authenticator など）に表示されている6桁のコードを入力してください。</p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="6桁のコード"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              autoFocus
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-lg tracking-[0.3em] text-center bg-surface text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            {error && (
              <p className="text-sm text-red-600" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !factorId}
              className="w-full px-4 py-2.5 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? '確認中…' : '確認する'}
            </button>
            <button type="button" onClick={handleSignOut} className="w-full text-xs text-gray-500 hover:text-gray-700">
              別のアカウントでログインする
            </button>
            <p className="text-[11px] text-gray-400 leading-relaxed">
              認証アプリが使えない場合は、組織の管理者または運営（サポート）にご連絡ください。本人確認のうえ二要素認証を解除します。
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
