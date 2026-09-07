'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ShieldCheck, CircleNotch } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { normalizeTotpCode } from '@/lib/auth/mfa'

/** LoginClient と同じ検証（オープンリダイレクト防止） */
function isSafeInternalPath(path: string | null): path is string {
  return !!path && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
}

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
    supabase.auth.mfa
      .listFactors()
      .then(({ data, error: listError }) => {
        if (!alive) return
        if (listError) {
          setError('二要素認証の情報を取得できませんでした。もう一度ログインしてください。')
          setLoading(false)
          return
        }
        const totp = (data?.totp ?? []).find((f) => f.status === 'verified')
        if (!totp) {
          // 登録が無いのにここへ来た（門番の誤判定 or 直接アクセス）→ そのまま先へ
          router.replace(isSafeInternalPath(redirect) ? redirect : '/')
          return
        }
        setFactorId(totp.id)
        setLoading(false)
      })
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
        const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized })
        if (verifyError) {
          setError('コードが違います。認証アプリに表示されている最新の6桁を入力してください。')
          setSubmitting(false)
          return
        }
        router.replace(isSafeInternalPath(redirect) ? redirect : '/')
      } catch {
        setError('確認に失敗しました。しばらくしてからもう一度お試しください。')
        setSubmitting(false)
      }
    },
    [factorId, code, submitting, redirect, router],
  )

  const handleSignOut = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }, [router])

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
