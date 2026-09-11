'use client'

import { isSafeInternalPath } from '@/lib/auth/safeRedirect'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton, GoogleSignInButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolvePostLoginLanding } from '@/lib/auth/resolveLanding'
import { formatAuthErrorMessage } from '@/lib/auth/authErrorMessage'
import { getActiveOrgId } from '@/lib/org/activeOrg'
import { needsMfaChallenge, MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'
import { UUID_REGEX } from '@/lib/uuid'

/**
 * 旧: 招待メールが /portal/<token> や /vendor-portal/<token> を案内していた時期の名残。
 * それらは公開ページではないため未ログインの受信者はここ(ログイン画面)に飛ばされる。
 * 「新規登録」を押すと別組織が新しく作られてしまうため、正しい入口 /invite/<token> へ誘導する。
 */
function legacyInviteTokenFromRedirect(redirect: string | null): string | null {
  if (!redirect) return null
  const match = /^\/(?:portal|vendor-portal)\/([^/]+)$/.exec(redirect)
  if (!match) return null
  const token = match[1]
  return UUID_REGEX.test(token) ? token : null
}

function shouldShowDemoAccounts(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'true'
}

// 本番ビルドでは NODE_ENV / NEXT_PUBLIC_* が静的置換され条件が false 定数になるため、
// この配列（デモ資格情報）ごとデッドコード除去されバンドルに残らない
const DEMO_ACCOUNTS = (process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === 'true') ? [
  { email: 'demo@example.com', password: 'demo1234', name: '田中 太郎', label: '内部PM', color: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-indigo-200', group: 'internal' as const },
  { email: 'staff1@example.com', password: 'staff1234', name: '佐藤 花子', label: 'デザイナー', color: 'bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200', group: 'internal' as const },
  { email: 'staff2@example.com', password: 'staff2345', name: '山田 次郎', label: '開発者', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200', group: 'internal' as const },
  { email: 'client1@client.com', password: 'client1234', name: '鈴木 一郎', label: 'クライアントPM', color: 'bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200', group: 'client' as const },
  { email: 'client2@client.com', password: 'client2345', name: '高橋 美咲', label: 'クライアント承認者', color: 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200', group: 'client' as const },
  { email: 'vendor1@vendor.com', password: 'vendor1234', name: '中村 健太', label: 'ベンダーDir', color: 'bg-teal-100 text-teal-700 hover:bg-teal-200 border-teal-200', group: 'vendor' as const },
  { email: 'vendor2@vendor.com', password: 'vendor2345', name: '松本 理恵', label: 'ベンダーDes', color: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200', group: 'vendor' as const },
] : []



/** ACTIVE_ORG_COOKIE から切替中のorgを読み、resolvePostLoginLanding の preferredOrgId に渡す */
async function resolveRedirect(supabase: SupabaseClient, userId: string): Promise<string> {
  return resolvePostLoginLanding(supabase, userId, { preferredOrgId: getActiveOrgId() })
}

/**
 * 二要素認証を登録済みなら、着地先を決める前にコード入力画面へ（コード入力前(aal1)は RLS で
 * 組織情報が読めず、着地判定が「組織なし」に化けてオンボーディングへ飛んでしまうため）。
 * 返り値: 回すべき URL、不要なら null
 */
async function mfaChallengeUrl(supabase: SupabaseClient, redirect: string | null): Promise<string | null> {
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  // 判定できない（Auth 障害等）ときはコード入力画面へ倒す。未登録なら画面側で判定し直してそのまま先へ進む
  if (!error && !needsMfaChallenge(aal?.currentLevel, aal?.nextLevel)) return null
  return `${MFA_CHALLENGE_PATH}${isSafeInternalPath(redirect) ? `?redirect=${encodeURIComponent(redirect)}` : ''}`
}

export default function LoginClient() {
  const searchParams = useSearchParams()
  const redirect = searchParams.get('redirect')
  const errorFromUrl = searchParams.get('error')
  const reasonFromUrl = searchParams.get('reason')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(formatAuthErrorMessage(errorFromUrl, reasonFromUrl))
  const [loading, setLoading] = useState(false)
  const [quickLoginLoading, setQuickLoginLoading] = useState<string | null>(null)
  const [loggedInEmail, setLoggedInEmail] = useState<string | null>(null)
  const [returningToApp, setReturningToApp] = useState(false)
  const legacyInviteToken = legacyInviteTokenFromRedirect(redirect)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      setLoggedInEmail(session?.user?.email ?? null)
    })
  }, [])

  async function handleReturnToApp() {
    setReturningToApp(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const mfa = await mfaChallengeUrl(supabase as SupabaseClient, redirect)
        // フルページ遷移で終える（ルート常駐のクライアント状態を作り直すため。router.push はしない）。
        // window.location.assign() は遷移を予約するだけですぐ返るため、ここで
        // setReturningToApp(false) すると実際にページが切り替わるまでボタンが一瞬押せる状態に
        // 戻ってしまう（遅い回線で顕著・二重実行の原因）。ページが破棄されるまで戻さない
        window.location.assign(mfa ?? (await resolveRedirect(supabase as SupabaseClient, session.user.id)))
        return
      }
      setReturningToApp(false)
    } catch {
      setError('ログイン中にエラーが発生しました')
      setReturningToApp(false)
    }
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
        setLoading(false)
        return
      }

      if (data.user) {
        const mfa = await mfaChallengeUrl(supabase as SupabaseClient, redirect)
        // サインインの完了はフルページ遷移で終える（ルート常駐のクライアント状態
        // ["currentUser"]・query cache・ActiveOrgProvider 等が前のユーザーの
        // ものを引きずらないようにするため。router.push はしない）。
        // window.location.assign() は遷移を予約するだけですぐ返るため、ここで
        // setLoading(false) すると実際にページが切り替わるまでボタンが一瞬押せる状態に戻り、
        // 遅い回線で二重送信（サインイン＋着地判定のやり直し）を招く。ページが破棄されるまで
        // ローディングのままにする（MfaChallengeClient・invite ページと同じ方針）
        if (mfa) {
          window.location.assign(mfa)
          return
        }
        // redirect パラメータ付き（招待のログインリンク等）は行き先が明示されて
        // いるのでそちらへ復帰。Google ログイン（auth/callback の next）と同じ挙動
        if (isSafeInternalPath(redirect)) {
          window.location.assign(redirect)
        } else {
          window.location.assign(await resolveRedirect(supabase as SupabaseClient, data.user.id))
        }
        return
      }

      setLoading(false)
    } catch {
      setError('ログイン中にエラーが発生しました')
      setLoading(false)
    }
  }

  async function handleQuickLogin(demoEmail: string, demoPassword: string) {
    setError('')
    setQuickLoginLoading(demoEmail)

    try {
      const supabase = createClient()
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: demoEmail,
        password: demoPassword,
      })

      if (authError) {
        setError('デモアカウントでのログインに失敗しました')
        setQuickLoginLoading(null)
        return
      }

      if (data.user) {
        const mfa = await mfaChallengeUrl(supabase as SupabaseClient, redirect)
        // 成功時はフルページ遷移で終えるので、ページが破棄されるまで
        // setQuickLoginLoading(null) しない（handleSubmit と同じ理由）
        if (mfa) {
          window.location.assign(mfa)
          return
        }
        if (isSafeInternalPath(redirect)) {
          window.location.assign(redirect)
        } else {
          window.location.assign(await resolveRedirect(supabase as SupabaseClient, data.user.id))
        }
        return
      }

      setQuickLoginLoading(null)
    } catch {
      setError('ログイン中にエラーが発生しました')
      setQuickLoginLoading(null)
    }
  }

  return (
    <AuthCard
      title="ログイン"
      footer={
        <>
          アカウントをお持ちでない方は{' '}
          <Link href="/signup" className="text-amber-600 hover:text-amber-700 font-medium">
            新規登録
          </Link>
        </>
      }
    >
      {legacyInviteToken && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
          招待メールのリンクから来た方で、まだアカウントをお持ちでない方は、
          <Link href={`/invite/${legacyInviteToken}`} className="font-medium underline">
            こちら
          </Link>
          から招待を受けてください。
        </div>
      )}

      {loggedInEmail && (
        <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800 flex items-center justify-between gap-3">
          <span>{loggedInEmail} としてログイン中です</span>
          <button
            type="button"
            onClick={handleReturnToApp}
            disabled={returningToApp}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
          >
            アプリへ戻る
          </button>
        </div>
      )}

      {/* Google Login (top, matches signup order) */}
      <div className="mb-4">
        <GoogleSignInButton
          label="Googleでログイン"
          redirectTo={redirect || undefined}
        />
      </div>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-surface px-2 text-gray-500">またはメールでログイン</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <AuthInput
          label="メールアドレス"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          required
          autoComplete="email"
        />

        <AuthInput
          label="パスワード"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="パスワードを入力"
          required
          autoComplete="current-password"
        />

        <div className="flex justify-end">
          <Link
            href="/reset"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            パスワードを忘れた方
          </Link>
        </div>

        <AuthButton type="submit" loading={loading}>
          ログイン
        </AuthButton>
      </form>

      {/* Demo Accounts Section (non-production only, unless explicitly enabled) */}
      {shouldShowDemoAccounts() && (
      <div className="mt-6 pt-6 border-t border-gray-200">
        <div className="text-xs text-gray-500 mb-3 text-center">テスト用デモアカウント</div>
        <div className="space-y-2">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => handleQuickLogin(account.email, account.password)}
              disabled={quickLoginLoading !== null}
              className={`w-full px-4 py-3 text-left rounded-lg border transition-colors ${account.color} ${
                quickLoginLoading === account.email ? 'opacity-50' : ''
              } disabled:cursor-not-allowed`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm">{account.name}</div>
                  <div className="text-xs opacity-75">{account.email}</div>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface/50">
                  {quickLoginLoading === account.email ? 'ログイン中...' : account.label}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
      )}
    </AuthCard>
  )
}
