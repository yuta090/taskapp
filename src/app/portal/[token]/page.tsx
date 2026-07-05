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

export default function PortalInvitePage({
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
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  // V5: ログイン中アカウントのメールが招待メールと不一致のとき、自動承認せず警告を出す
  const [emailMismatch, setEmailMismatch] = useState(false)

  const acceptInvite = useCallback(async (isAutoAccept: boolean) => {
    setLoading(true)
    setError('')

    try {
      if (!isAutoAccept && password.length < 8) {
        setError('パスワードは8文字以上で入力してください')
        setLoading(false)
        return
      }

      // サーバーサイドで受諾（新規ユーザー作成はサーバー側で招待メールのアドレスを使って行う）
      const response = await fetch(`/api/invites/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: isAutoAccept ? undefined : JSON.stringify({ password }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(data.error || 'エラーが発生しました')
        setLoading(false)
        return
      }

      if (!isAutoAccept) {
        const supabase = createClient()
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: data.email,
          password,
        })

        if (signInError) {
          setError(signInError.message)
          setLoading(false)
          return
        }
      }

      // リダイレクト（クライアント用）
      router.push('/portal')
    } catch (err) {
      console.error('Accept error:', err)
      setError('エラーが発生しました')
      setLoading(false)
    }
  }, [password, token, router])

  useEffect(() => {
    async function loadInvite() {
      const supabase = createClient()

      // 現在のセッションを確認
      const { data: { session } } = await supabase.auth.getSession()
      setIsLoggedIn(!!session)
      setSessionEmail(session?.user?.email ?? null)

      // 招待情報を取得
      const { data, error } = await (supabase as SupabaseClient).rpc('rpc_validate_invite', {
        p_token: token,
      })

      if (error) {
        setInviteInfo({ valid: false, error: 'トークンが無効です' } as InviteInfo)
      } else {
        setInviteInfo(data)

        // ログイン済みでも、招待宛先のアカウントである場合のみ自動受諾する
        // （wrong-account join 防止。不一致ならアカウント切替を案内）
        if (session && data.valid) {
          if (shouldAutoAcceptInvite(session.user?.email, data.email)) {
            await acceptInvite(true)
          } else {
            setEmailMismatch(true)
          }
        }
      }

      setCheckingAuth(false)
    }

    loadInvite()
  }, [token, acceptInvite])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await acceptInvite(false)
  }

  if (checkingAuth) {
    return (
      <AuthCard title="確認中...">
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-amber-600" viewBox="0 0 24 24">
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
          <p className="text-sm text-gray-500 mb-3">
            既に参加済みの場合はログインしてください。
          </p>
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

  // 別アカウントでログイン中（招待宛先とメール不一致）→ 切替を案内
  if (isLoggedIn && emailMismatch) {
    return (
      <AuthCard
        title="別のアカウントでログイン中です"
        description="この招待は、現在ログイン中のアカウントとは別のメールアドレス宛です。"
      >
        <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200 text-sm text-amber-800 space-y-1">
          <p>
            ログイン中: <strong>{sessionEmail}</strong>
          </p>
          <p>
            招待の宛先: <strong>{inviteInfo.email}</strong>
          </p>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          招待を受けるには、宛先のメールアドレスのアカウントに切り替えてください。
        </p>
        <AuthButton
          type="button"
          onClick={async () => {
            const supabase = createClient()
            await supabase.auth.signOut()
            setIsLoggedIn(false)
            setSessionEmail(null)
            setEmailMismatch(false)
          }}
        >
          ログアウトして招待を受ける
        </AuthButton>
      </AuthCard>
    )
  }

  // ログイン済みで処理中
  if (isLoggedIn && loading) {
    return (
      <AuthCard title="参加処理中...">
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-amber-600" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </AuthCard>
    )
  }

  // 既存ユーザーが未ログイン: パスワード検証に到達させず、ログインへ誘導する
  if (inviteInfo.is_existing_user && !isLoggedIn) {
    return (
      <AuthCard title={`${inviteInfo.org_name} に招待されました`}>
        <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
          <p className="text-sm text-amber-800">
            <strong>{inviteInfo.inviter_name || '管理者'}</strong> さんから
            <br />
            <strong>{inviteInfo.space_name}</strong> のレビューに招待されました。
          </p>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          <strong>{inviteInfo.email}</strong> は既にアカウントをお持ちです。ログインして参加してください。
        </p>
        <AuthButton
          type="button"
          onClick={() => router.push(`/login?redirect=/portal/${token}`)}
        >
          ログインして参加
        </AuthButton>
      </AuthCard>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md">
        {/* Logo with Client Badge */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <span className="text-white font-semibold text-sm">A</span>
            </div>
            <span className="text-xl font-semibold text-gray-900">AgentPM</span>
          </Link>
          <div className="mt-2">
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded">
              クライアントポータル
            </span>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <div className="text-center mb-6">
            <h1 className="text-xl font-semibold text-gray-900">
              {inviteInfo.org_name} に招待されました
            </h1>
          </div>

          <div className="mb-6 p-4 bg-amber-50 rounded-lg border border-amber-200">
            <p className="text-sm text-amber-800">
              <strong>{inviteInfo.inviter_name || '管理者'}</strong> さんから
              <br />
              <strong>{inviteInfo.space_name}</strong> のレビューに招待されました。
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
              {inviteInfo.is_existing_user ? 'ポータルに参加' : 'アカウントを作成して参加'}
            </AuthButton>
          </form>
        </div>
      </div>
    </div>
  )
}
