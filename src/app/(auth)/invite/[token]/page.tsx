'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'
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

export default function InviteAcceptPage({
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

  const acceptInvite = useCallback(async (userId?: string) => {
    setLoading(true)
    setError('')

    try {
      const supabase = createClient()

      if (!userId) {
        // 新規ユーザーの場合、まず登録
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

      // 招待を受諾
      const { error: acceptError } = await (supabase as SupabaseClient).rpc('rpc_accept_invite', {
        p_token: token,
        p_user_id: userId,
      })

      if (acceptError) {
        setError(acceptError.message)
        setLoading(false)
        return
      }

      // リダイレクト（内部メンバー用）
      router.push(`/${inviteInfo!.org_id}/project/${inviteInfo!.space_id}`)
    } catch (err) {
      console.error('Accept error:', err)
      setError('エラーが発生しました')
      setLoading(false)
    }
  }, [password, inviteInfo, token, router])

  useEffect(() => {
    async function loadInvite() {
      const supabase = createClient()

      // 現在のセッションを確認
      const { data: { session } } = await supabase.auth.getSession()
      setIsLoggedIn(!!session)

      // 招待情報を取得
      const { data, error } = await (supabase as SupabaseClient).rpc('rpc_validate_invite', {
        p_token: token,
      })

      if (error) {
        setInviteInfo({ valid: false, error: 'トークンが無効です' } as InviteInfo)
      } else {
        setInviteInfo(data)

        // ログイン済みの場合は自動で受諾
        if (session && data.valid) {
          await acceptInvite(session.user.id)
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
          <svg className="animate-spin h-8 w-8 text-amber-500" viewBox="0 0 24 24">
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
            className="text-sm text-amber-600 hover:text-amber-700 font-medium"
          >
            ログインページへ
          </Link>
        </div>
      </AuthCard>
    )
  }

  // ログイン済みで処理中
  if (isLoggedIn && loading) {
    return (
      <AuthCard title="参加処理中...">
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-amber-500" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title={`${inviteInfo.org_name} に招待されました`}
      footer={
        inviteInfo.is_existing_user && !isLoggedIn ? (
          <>
            すでにアカウントをお持ちの方は{' '}
            <Link href={`/login?redirect=/invite/${token}`} className="text-amber-600 hover:text-amber-700 font-medium">
              ログイン
            </Link>
          </>
        ) : null
      }
    >
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-600">
          <strong>{inviteInfo.inviter_name || '管理者'}</strong> さんから
          <br />
          <strong>{inviteInfo.space_name}</strong> に招待されました。
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
          {inviteInfo.is_existing_user ? 'チームに参加' : 'アカウントを作成して参加'}
        </AuthButton>
      </form>
    </AuthCard>
  )
}
