'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { FileText } from '@phosphor-icons/react'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { GenrePicker, GenrePreview, ICON_MAP } from '@/components/space/GenrePicker'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getPreset, type PresetGenre } from '@/lib/presets'

type Step = 'org' | 'project'

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('org')
  const [orgId, setOrgId] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [selectedGenre, setSelectedGenre] = useState<PresetGenre | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    async function checkState() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace('/login')
        return
      }

      setUserEmail(user.email ?? null)

      // signup時に登録した組織名があればプレフィル
      const metadataOrgName = user.user_metadata?.org_name
      if (metadataOrgName) {
        setOrgName(metadataOrgName)
        setPrefilled(true)
      }

      // 表示名のプレフィル: signup時の氏名 → メールのローカル部の順で採用
      const metadataName =
        user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0]
      if (metadataName) {
        setDisplayName(metadataName)
      }

      const { data: membership } = await (supabase as SupabaseClient)
        .from('org_memberships')
        .select('org_id, role')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle()

      if (membership) {
        if (membership.role === 'client') {
          router.replace('/portal')
          return
        }

        const { data: space } = await (supabase as SupabaseClient)
          .from('spaces')
          .select('id')
          .eq('org_id', membership.org_id)
          .eq('type', 'project')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (space) {
          // セットアップ完了済みなら、最後にアクセスした現在の組織のページに復帰。
          // プロジェクト未作成の段階で lastPath（/inbox 等）に飛ばすと
          // Step2 再開がスキップされるため、space 確認後にのみ使う
          const lastPath = localStorage.getItem('taskapp:lastPath')
          if (lastPath && lastPath.startsWith(`/${membership.org_id}/`)) {
            router.replace(lastPath)
            return
          }
          router.replace(`/${membership.org_id}/project/${space.id}`)
          return
        }

        // 組織はあるがプロジェクトが無い（作成途中で離脱した等）→ ステップ2から再開
        setOrgId(membership.org_id)
        setStep('project')
      }

      setChecking(false)
    }

    checkState()
  }, [router])

  async function handleCreateOrg(e: React.FormEvent) {
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
        setOrgId(existingMembership.org_id)
        setStep('project')
        return
      }

      const { data: rpcResult, error: orgError } = await (supabase as SupabaseClient).rpc(
        'rpc_create_org_with_billing',
        {
          p_org_name: orgName,
          p_user_id: user.id,
        }
      )

      if (orgError || !rpcResult?.org_id) {
        console.error('Org creation error:', orgError)
        setError('組織の作成に失敗しました。もう一度お試しください。')
        return
      }

      setOrgId(rpcResult.org_id as string)

      // 表示名の反映は失敗してもオンボーディングを止めない（update ではなく upsert: RLS の self-insert を通す）
      // 空白のみの入力で既存の表示名を空文字上書きしないようガードする
      const trimmedDisplayName = displayName.trim()
      if (trimmedDisplayName) {
        try {
          const { error: profileError } = await (supabase as SupabaseClient)
            .from('profiles')
            .upsert({ id: user.id, display_name: trimmedDisplayName }, { onConflict: 'id' })
          if (profileError) {
            console.warn('Failed to save display name:', profileError)
          }
        } catch (profileErr) {
          console.warn('Failed to save display name:', profileErr)
        }
      }

      // ウェルカムメール送信は fire-and-forget。失敗（同期エラー含む）してもオンボーディングは止めない
      try {
        fetch('/api/onboarding/welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgName }),
        }).catch((welcomeErr) => {
          console.warn('Welcome email request failed:', welcomeErr)
        })
      } catch (welcomeErr) {
        console.warn('Welcome email request failed:', welcomeErr)
      }

      setStep('project')
    } catch (err) {
      console.error('Onboarding error:', err)
      setError('エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  /**
   * 別のアカウントでやり直す（ログアウト → /login）。
   * この画面はログイン直後に「会員でないアカウント」が最初に着地する場所で、ここにログアウトが無いと
   * 逃げ道が無い（/login に戻っても proxy が /onboarding へ押し戻す）。そのため両ステップに置く。
   * 先に signOut を待ってから遷移する: 先に /login へ動くとセッションが残っていて再び /onboarding に戻される。
   */
  async function handleSwitchAccount() {
    if (signingOut) return
    setSigningOut(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
    } catch (err) {
      console.warn('Sign out failed:', err)
    } finally {
      router.replace('/login')
    }
  }

  const switchAccountFooter = (
    <div className="space-y-1">
      {userEmail && (
        <p className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">{userEmail}</span> でログイン中
        </p>
      )}
      <button
        type="button"
        onClick={handleSwitchAccount}
        disabled={signingOut}
        className="text-sm text-gray-600 underline underline-offset-2 hover:text-gray-900 disabled:opacity-50"
      >
        {signingOut ? 'ログアウト中...' : '別のアカウントでログイン（ログアウト）'}
      </button>
    </div>
  )

  /**
   * カードは「選ぶ」だけ。作成は下の「プロジェクトを作成する」ボタンで行う。
   * 以前はカードを押した瞬間に作成していたため、何が作られるか分からないまま
   * プロジェクトが出来てしまっていた。
   */
  function handleSelectGenre(genre: PresetGenre) {
    if (loading) return
    setError('')
    setSelectedGenre(genre)
  }

  async function handleCreateProject() {
    if (loading) return
    setError('')

    const genre = selectedGenre
    if (!genre) {
      setError('テンプレートを選んでください。')
      return
    }

    const name = projectName.trim()
    if (!name) {
      setError('プロジェクト名を入力してください。')
      return
    }
    if (!orgId) {
      setError('組織情報を取得できませんでした。再読み込みしてください。')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/spaces/create-with-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, presetGenre: genre, orgId }),
      })
      const data = await res.json()

      if (!res.ok || !data.space?.id) {
        console.error('Space creation error:', data.error)
        setError('プロジェクトの作成に失敗しました。もう一度お試しください。')
        return
      }

      // 初回セットアップ完了の目印 ?onboarded=1 を付けて遷移する。
      // アクセス解析（GTM/GA4）で「会員登録→設定完了」をこのURLで CV として数える。
      // 着地先は毎日の作業画面と同じURLなので、目印が無いと区別できない。
      // AppShell が保存する lastPath は pathname のみ（query を含まない）ので、
      // 次回以降のログインで再び ?onboarded=1 に着地することはない。
      router.push(`/${orgId}/project/${data.space.id}?onboarded=1`)
    } catch (err) {
      console.error('Space creation error:', err)
      setError('プロジェクトの作成に失敗しました。もう一度お試しください。')
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

  // ---------------------------------------------------------------------------
  // Step 2: 最初のプロジェクト作成（テンプレート選択）
  // ---------------------------------------------------------------------------
  if (step === 'project') {
    const selectedPreset = selectedGenre ? getPreset(selectedGenre) : null
    return (
      <AuthCard
        title="最初のプロジェクトを作成"
        description="業種に合ったテンプレートを選ぶと、Wikiとマイルストーンが自動でセットアップされます。"
        footer={switchAccountFooter}
        width="wide"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
              {error}
            </div>
          )}

          <AuthInput
            label="プロジェクト名"
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="例: コーポレートサイト制作"
            required
          />

          <GenrePicker onSelect={handleSelectGenre} selectedGenre={selectedGenre} />

          {selectedPreset && (
            <div className="space-y-3 border-t border-gray-200 pt-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded text-sm">
                  <span className="text-base">
                    {ICON_MAP[selectedPreset.icon] || <FileText weight="duotone" />}
                  </span>
                  {selectedPreset.label}
                </span>
                <span className="text-sm text-gray-600">{selectedPreset.description}</span>
              </div>

              {selectedPreset.genre === 'blank' ? (
                <p className="text-xs text-gray-500">
                  Wikiやマイルストーンは作らず、空のプロジェクトだけを作ります。あとから設定画面でテンプレートを適用することもできます。
                </p>
              ) : (
                <GenrePreview preset={selectedPreset} />
              )}

              <AuthButton type="button" onClick={handleCreateProject} loading={loading}>
                このテンプレートでプロジェクトを作成する
              </AuthButton>
            </div>
          )}
        </div>
      </AuthCard>
    )
  }

  // ---------------------------------------------------------------------------
  // Step 1: 組織作成
  // ---------------------------------------------------------------------------
  return (
    <AuthCard
      title="組織を作成"
      description={
        prefilled
          ? '登録時の組織名を確認して開始してください。'
          : 'あと少しで完了です。組織名を入力してください。'
      }
      footer={switchAccountFooter}
    >
      <form onSubmit={handleCreateOrg} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
            {error}
          </div>
        )}

        <AuthInput
          label="あなたの名前"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="山田太郎"
          required
        />

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
