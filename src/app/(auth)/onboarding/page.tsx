'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export default function OnboardingPage() {
  const router = useRouter()
  const [orgName, setOrgName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    async function checkState() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/login')
        return
      }

      // 既にmembershipがある場合はスキップ
      const { data: membership } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (membership) {
        if (membership.role === 'client') {
          router.replace('/portal')
        } else {
          const { data: space } = await (supabase as SupabaseClient)
            .from('spaces')
            .select('id')
            .eq('org_id', membership.org_id)
            .eq('type', 'project')
            .order('created_at', { ascending: true })
            .limit(1)
            .single()

          if (space) {
            router.replace(`/${membership.org_id}/project/${space.id}`)
          } else {
            router.replace('/inbox')
          }
        }
        return
      }

      setChecking(false)
    }

    checkState()
  }, [router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/login')
        return
      }

      // 冪等性ガード: RPC呼出前に再チェック
      const { data: existingMembership } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (existingMembership) {
        router.replace('/inbox')
        return
      }

      const { error: orgError } = await (supabase as SupabaseClient).rpc(
        'rpc_create_org_with_billing',
        {
          p_org_name: orgName,
          p_user_id: user.id,
        }
      )

      if (orgError) {
        console.error('Org creation error:', orgError)
        setError('組織の作成に失敗しました。もう一度お試しください。')
        return
      }

      // 作成されたスペースへリダイレクト
      const { data: membership } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', user.id)
        .limit(1)
        .single()

      if (membership) {
        const { data: space } = await (supabase as SupabaseClient)
          .from('spaces')
          .select('id')
          .eq('org_id', membership.org_id)
          .eq('type', 'project')
          .order('created_at', { ascending: true })
          .limit(1)
          .single()

        if (space) {
          router.push(`/${membership.org_id}/project/${space.id}`)
          return
        }
      }

      router.push('/inbox')
    } catch (err) {
      console.error('Onboarding error:', err)
      setError('エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <AuthCard title="確認中...">
        <div className="flex justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-amber-500" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="組織を作成"
      description="あと少しで完了です。組織名を入力してください。"
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

        <AuthButton type="submit" loading={loading}>
          開始する
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
