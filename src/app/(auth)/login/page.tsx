'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'

const DEMO_ACCOUNTS = [
  { email: 'demo@example.com', password: 'demo1234', name: '田中 太郎', label: '内部PM', color: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200 border-indigo-200' },
  { email: 'staff1@example.com', password: 'staff1234', name: '佐藤 花子', label: 'デザイナー', color: 'bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200' },
  { email: 'staff2@example.com', password: 'staff2345', name: '山田 次郎', label: '開発者', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200' },
  { email: 'client1@client.com', password: 'client1234', name: '鈴木 一郎', label: 'クライアントPM', color: 'bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200' },
  { email: 'client2@client.com', password: 'client2345', name: '高橋 美咲', label: 'クライアント承認者', color: 'bg-orange-100 text-orange-700 hover:bg-orange-200 border-orange-200' },
]

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [quickLoginLoading, setQuickLoginLoading] = useState<string | null>(null)

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
        // ユーザーのロールを取得してリダイレクト先を決定
        const { data: membership } = await (supabase as any)
          .from('org_memberships')
          .select('org_id, role')
          .eq('user_id', data.user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        if (membership?.role === 'client') {
          router.push('/portal')
        } else if (membership) {
          // 最初のスペースを取得
          const { data: space } = await (supabase as any)
            .from('spaces')
            .select('id')
            .eq('org_id', membership.org_id)
            .eq('type', 'project')
            .order('created_at', { ascending: true })
            .limit(1)
            .single()

          if (space) {
            router.push(`/${membership.org_id}/project/${space.id}`)
          } else {
            router.push('/inbox')
          }
        } else {
          router.push('/inbox')
        }
      }
    } catch {
      setError('ログイン中にエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  async function handleQuickLogin(demoEmail: string, demoPassword: string) {
    console.log('handleQuickLogin called:', demoEmail)
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
        return
      }

      if (data.user) {
        const { data: membership } = await (supabase as any)
          .from('org_memberships')
          .select('org_id, role')
          .eq('user_id', data.user.id)
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        if (membership?.role === 'client') {
          router.push('/portal')
        } else if (membership) {
          const { data: space } = await (supabase as any)
            .from('spaces')
            .select('id')
            .eq('org_id', membership.org_id)
            .eq('type', 'project')
            .order('created_at', { ascending: true })
            .limit(1)
            .single()

          if (space) {
            router.push(`/${membership.org_id}/project/${space.id}`)
          } else {
            router.push('/inbox')
          }
        } else {
          router.push('/inbox')
        }
      }
    } catch {
      setError('ログイン中にエラーが発生しました')
    } finally {
      setQuickLoginLoading(null)
    }
  }

  return (
    <AuthCard
      title="ログイン"
      footer={
        <>
          アカウントをお持ちでない方は{' '}
          <Link href="/signup" className="text-indigo-600 hover:text-indigo-700 font-medium">
            新規登録
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

      {/* Demo Accounts Section */}
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
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/50">
                  {quickLoginLoading === account.email ? 'ログイン中...' : account.label}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </AuthCard>
  )
}
