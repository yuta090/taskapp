'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AgentPmMark } from '@/components/brand/AgentPmMark'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

/** Google ログイン後の戻り先。(panel) layout が旗を確認し、無ければこの画面へ戻す */
const ADMIN_HOME = '/admin/dashboard'

/**
 * 管理者ログイン画面。
 *
 * メール+パスワードに加えて Google でも入れる。Google の場合は /auth/callback → ADMIN_HOME に
 * 戻り、(panel) layout の superadmin ゲートが旗を確認する。旗が無いユーザーはここへ戻されるので、
 * 「ログイン済みだが運営ではない」状態をこの画面で検知して理由を出し、ログアウト手段を用意する
 * （そうしないと Google で入った一般ユーザーが理由も分からず同じ画面を往復する）。
 */
export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [signedInAs, setSignedInAs] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function checkExistingSession() {
      try {
        const supabase = createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user || cancelled) return
        const { data: profile } = await (supabase as SupabaseClient)
          .from('profiles')
          .select('is_superadmin')
          .eq('id', user.id)
          .single()
        if (cancelled) return
        if (profile?.is_superadmin) {
          router.replace(ADMIN_HOME)
          return
        }
        setSignedInAs(user.email ?? '')
        setError('管理者権限がありません')
      } catch {
        // セッション確認に失敗しても通常のログインフォームは使える
      }
    }
    void checkExistingSession()
    return () => {
      cancelled = true
    }
  }, [router])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setSignedInAs(null)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (authError) {
        setError('メールアドレスまたはパスワードが正しくありません')
        return
      }

      if (data.user) {
        // superadmin チェック
        const { data: profile } = await (supabase as SupabaseClient)
          .from('profiles')
          .select('is_superadmin')
          .eq('id', data.user.id)
          .single()

        if (!profile?.is_superadmin) {
          await supabase.auth.signOut()
          setError('管理者権限がありません')
          return
        }

        router.push(ADMIN_HOME)
      }
    } catch {
      setError('ログイン中にエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <AgentPmMark size={24} className="text-white" />
            </div>
            <span className="text-xl font-bold text-gray-900">AgentPM Admin</span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-surface rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900">管理者ログイン</h1>
            <p className="mt-2 text-sm text-gray-600">システム管理者アカウントでログイン</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              <p>{error}</p>
              {signedInAs !== null && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-red-600 truncate">
                    {signedInAs ? `${signedInAs} でログイン中` : 'ログイン中'}
                  </span>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="shrink-0 text-xs font-medium text-red-700 underline hover:text-red-800"
                  >
                    ログアウト
                  </button>
                </div>
              )}
            </div>
          )}

          <GoogleSignInButton label="Google でログイン" redirectTo={ADMIN_HOME} />

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-surface text-gray-500">または</span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                メールアドレス
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
                autoComplete="email"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-700">
                パスワード
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="パスワードを入力"
                required
                autoComplete="current-password"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  処理中...
                </span>
              ) : (
                'ログイン'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
