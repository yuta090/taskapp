'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'
import { shouldAutoAcceptInvite } from '@/lib/invite/emailMatch'
import type { SupabaseClient } from '@supabase/supabase-js'

interface InviteInfo {
  valid: boolean
  email: string
  role: string
  org_id: string
  org_name: string
  space_id: string
  space_name: string
  inviter_name: string
  expires_at: string
  is_existing_user: boolean
  error?: string
}

export default function VendorInvitePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = use(params)
  const router = useRouter()
  const [inviteInfo, setInviteInfo] = useState<InviteInfo | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  // V5: ログイン中アカウントのメールが招待メールと不一致のとき、自動承認せず警告を出す
  const [emailMismatch, setEmailMismatch] = useState<{ invited: string; current: string } | null>(null)

  const acceptInvite = useCallback(async (userId?: string) => {
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()

      if (!userId) {
        if (password.length < 8) {
          setError('パスワードは8文字以上で入力してください')
          setLoading(false)
          return
        }

        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: inviteInfo!.email,
          password,
        })

        if (authError) {
          setError(authError.message)
          setLoading(false)
          return
        }

        if (!authData.user) {
          setError('ユーザー作成に失敗しました')
          setLoading(false)
          return
        }

        userId = authData.user.id
      }

      const { error: acceptError } = await (supabase as SupabaseClient).rpc('rpc_accept_invite', {
        p_token: token,
        p_user_id: userId,
      })

      if (acceptError) {
        setError(acceptError.message)
        setLoading(false)
        return
      }

      router.push('/vendor-portal')
    } catch (err) {
      console.error('Accept error:', err)
      setError('エラーが発生しました')
      setLoading(false)
    }
  }, [password, inviteInfo, token, router])

  useEffect(() => {
    async function loadInvite() {
      const supabase = createClient()

      const { data: { session } } = await supabase.auth.getSession()
      setIsLoggedIn(!!session)

      const { data, error } = await (supabase as SupabaseClient).rpc('rpc_validate_invite', {
        p_token: token,
      })

      if (error) {
        setInviteInfo({ valid: false, error: 'トークンが無効です' } as InviteInfo)
      } else {
        setInviteInfo(data)

        if (session && data.valid) {
          if (shouldAutoAcceptInvite(session.user.email, data.email)) {
            await acceptInvite(session.user.id)
          } else {
            // 別アカウントでログイン中: 自動承認せず、正しいアカウントを促す
            setEmailMismatch({ invited: data.email, current: session.user.email ?? '' })
          }
        }
      }

      setCheckingAuth(false)
    }

    loadInvite()
  }, [token, acceptInvite])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await acceptInvite()
  }

  if (checkingAuth) {
    return (
      <AuthCard title="確認中...">
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-indigo-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </AuthCard>
    )
  }

  if (!inviteInfo || !inviteInfo.valid) {
    return (
      <AuthCard
        title="招待が無効です"
        description={inviteInfo?.error || 'この招待リンクは無効または期限切れです。'}
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <Link
            href="/login"
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            ログインページへ
          </Link>
        </div>
      </AuthCard>
    )
  }

  // V5: 別アカウントでログイン中（招待メールと不一致）— 自動承認せず正しいアカウントを促す
  if (emailMismatch) {
    return (
      <AuthCard
        title="別のアカウントでログイン中です"
        description="この招待はご利用中のアカウントとは別のメールアドレス宛です。誤ったアカウントへの参加を防ぐため、自動での参加を停止しました。"
      >
        <div className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm">
            <p className="text-gray-700">招待先: <strong className="text-amber-700">{emailMismatch.invited}</strong></p>
            <p className="text-gray-700 mt-1">ログイン中: <strong>{emailMismatch.current}</strong></p>
          </div>
          <AuthButton
            type="button"
            onClick={async () => {
              const supabase = createClient()
              await supabase.auth.signOut()
              window.location.reload()
            }}
          >
            別のアカウントでログインし直す
          </AuthButton>
          <Link href="/vendor-portal" className="block text-center text-sm text-gray-500 hover:text-gray-700">
            現在のアカウントのポータルに戻る
          </Link>
        </div>
      </AuthCard>
    )
  }

  if (isLoggedIn && loading) {
    return (
      <AuthCard title="参加処理中...">
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-indigo-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </AuthCard>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">TA</span>
            </div>
            <span className="text-xl font-bold text-gray-900">TaskApp</span>
          </Link>
          <div className="mt-2">
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs font-medium rounded">
              ベンダーポータル
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-bold text-gray-900">
              {inviteInfo.org_name} に招待されました
            </h1>
          </div>

          <div className="mb-6 p-4 bg-indigo-50 rounded-lg border border-indigo-200">
            <p className="text-sm text-indigo-800">
              <strong>{inviteInfo.inviter_name || '管理者'}</strong> さんから
              <br />
              <strong>{inviteInfo.space_name}</strong> にベンダーとして招待されました。
            </p>
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
              value={inviteInfo.email}
              disabled
            />

            {!inviteInfo.is_existing_user && (
              <AuthInput
                label="パスワードを設定"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8文字以上"
                required
                autoComplete="new-password"
              />
            )}

            <AuthButton type="submit" loading={loading}>
              {inviteInfo.is_existing_user ? 'ベンダーポータルに参加' : 'アカウントを作成して参加'}
            </AuthButton>
          </form>

          {inviteInfo.is_existing_user && !isLoggedIn && (
            <div className="mt-4 text-center text-sm text-gray-600">
              すでにアカウントをお持ちの方は{' '}
              <Link href={`/login?redirect=/vendor-portal/${token}`} className="text-indigo-600 hover:text-indigo-700 font-medium">
                ログイン
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
