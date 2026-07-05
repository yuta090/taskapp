'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton, GoogleSignInButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

const RESEND_COOLDOWN_SECONDS = 60

function SignupForm() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendMessage, setResendMessage] = useState('')

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setPasswordError('')

    // パスワードバリデーション(フィールド直下に表示)
    if (password.length < 8) {
      setPasswordError('パスワードは8文字以上で入力してください')
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()

      // 1. ユーザー作成
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            org_name: orgName,
          },
        },
      })

      if (authError) {
        if (authError.message.includes('already registered')) {
          setError('このメールアドレスは既に登録されています')
        } else {
          setError(authError.message)
        }
        return
      }

      if (!authData.user) {
        setError('ユーザー作成に失敗しました')
        return
      }

      // メール確認が必要でセッションが無い場合は、RPCを呼ばず成功画面へ
      // (匿名でのRPC実行を避けるため)
      if (!authData.session) {
        setSuccess(true)
        return
      }

      // セッションがある場合のみ組織とbillingを作成 (RPC)
      const { error: orgError } = await (supabase as SupabaseClient).rpc(
        'rpc_create_org_with_billing',
        {
          p_org_name: orgName,
          p_user_id: authData.user.id,
        }
      )

      if (orgError) {
        console.error('Org creation error:', orgError)
        setError('組織の作成に失敗しました。もう一度お試しください。')
        return
      }

      // 組織は出来たがプロジェクトが無い状態 → テンプレート選択（Step2）へ
      router.push('/onboarding')
    } catch (err) {
      console.error('Signup error:', err)
      setError('登録中にエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return

    const supabase = createClient()
    const { error: resendError } = await supabase.auth.resend({
      type: 'signup',
      email,
    })

    if (resendError) {
      setResendMessage('再送に失敗しました。もう一度お試しください。')
      return
    }

    setResendMessage(`再送しました（${RESEND_COOLDOWN_SECONDS}秒後に再送可能）`)
    setResendCooldown(RESEND_COOLDOWN_SECONDS)
  }

  if (success) {
    return (
      <AuthCard
        title="確認メールを送信しました"
        description="メール内のリンクをクリックすると、自動的にログインされ設定が続行されます。"
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-green-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            <strong>{email}</strong> に確認メールを送信しました。
          </p>

          <div className="text-left text-xs text-gray-500 space-y-2 mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <p>メールが届かない場合は迷惑メールフォルダをご確認ください。</p>
            <p>既にアカウントをお持ちの場合、確認メールは届きません。ログインまたはパスワードリセットをお試しください。</p>
            <p className="flex gap-2">
              <Link href="/login" className="text-amber-600 hover:text-amber-700 font-medium">
                ログイン
              </Link>
              <Link href="/reset" className="text-amber-600 hover:text-amber-700 font-medium">
                パスワードリセット
              </Link>
            </p>
          </div>

          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0}
            className="text-sm text-amber-600 hover:text-amber-700 font-medium disabled:text-gray-400 disabled:cursor-not-allowed mb-2"
          >
            確認メールを再送する
          </button>
          {resendMessage && (
            <p className="text-xs text-gray-500 mb-4">{resendMessage}</p>
          )}

          <div>
            <Link
              href="/login"
              className="text-sm text-amber-600 hover:text-amber-700 font-medium"
            >
              ログインページへ
            </Link>
          </div>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="新規登録"
      description="Freeプランで開始できます"
      footer={
        <>
          すでにアカウントをお持ちの方は{' '}
          <Link href="/login" className="text-amber-600 hover:text-amber-700 font-medium">
            ログイン
          </Link>
        </>
      }
    >
      {/* Google Signup (top, more prominent) */}
      <div className="mb-4">
        <GoogleSignInButton label="Googleで登録" />
      </div>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-gray-200" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-white px-2 text-gray-500">またはメールで登録</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <AuthInput
          label="組織名"
          type="text"
          value={orgName}
          onChange={(e) => setOrgName(e.target.value)}
          placeholder="株式会社サンプル"
          required
        />

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
          placeholder="8文字以上"
          required
          autoComplete="new-password"
          error={passwordError}
        />

        <AuthButton type="submit" loading={loading}>
          アカウント作成
        </AuthButton>

        {/* Freeプランの説明 */}
        <div className="mt-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs font-medium text-gray-700 mb-2">Free プランに含まれるもの:</p>
          <ul className="text-xs text-gray-600 space-y-1">
            <li className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              プロジェクト 5件
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              チームメンバー 5名
            </li>
            <li className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              クライアント 5名
            </li>
          </ul>
        </div>
      </form>
    </AuthCard>
  )
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  )
}
