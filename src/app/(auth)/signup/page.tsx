'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // パスワードバリデーション
      if (password.length < 8) {
        setError('パスワードは8文字以上で入力してください')
        return
      }

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

      // 2. 組織とbilling作成 (RPC)
      const { data: orgData, error: orgError } = await (supabase as any).rpc(
        'rpc_create_org_with_billing',
        {
          p_org_name: orgName,
          p_user_id: authData.user.id,
        }
      )

      if (orgError) {
        console.error('Org creation error:', orgError)
        // ユーザーは作成されたが、メール確認が必要な場合
        setSuccess(true)
        return
      }

      // メール確認が必要な場合
      if (!authData.session) {
        setSuccess(true)
        return
      }

      // セッションがある場合は直接リダイレクト
      router.push('/inbox')
    } catch (err) {
      console.error('Signup error:', err)
      setError('登録中にエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthCard
        title="確認メールを送信しました"
        description="メールに記載されたリンクをクリックして、登録を完了してください。"
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

  return (
    <AuthCard
      title="新規登録"
      description="Freeプランで開始できます"
      footer={
        <>
          すでにアカウントをお持ちの方は{' '}
          <Link href="/login" className="text-indigo-600 hover:text-indigo-700 font-medium">
            ログイン
          </Link>
        </>
      }
    >
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
