'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'

export default function ResetPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset/confirm`,
      })

      if (resetError) {
        setError(resetError.message)
        return
      }

      setSuccess(true)
    } catch {
      setError('エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <AuthCard
        title="メールを送信しました"
        description="パスワードリセットのリンクをメールで送信しました。"
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            <strong>{email}</strong> にリセットリンクを送信しました。
            <br />
            メールに記載されたリンクをクリックして、パスワードを再設定してください。
          </p>
          <Link
            href="/login"
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium"
          >
            ログインページへ戻る
          </Link>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="パスワードをリセット"
      description="登録したメールアドレスを入力してください"
      footer={
        <Link href="/login" className="text-gray-600 hover:text-gray-900">
          ログインに戻る
        </Link>
      }
    >
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

        <AuthButton type="submit" loading={loading}>
          リセットリンクを送信
        </AuthButton>
      </form>
    </AuthCard>
  )
}
