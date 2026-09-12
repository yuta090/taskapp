'use client'

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AuthCard, AuthInput, AuthButton } from '@/components/auth'
import { createClient } from '@/lib/supabase/client'
import { signOutAndLeave } from '@/lib/auth/signOutClient'
import { shouldAutoAcceptInvite } from '@/lib/invite/emailMatch'
import { describeAcceptInviteError, isMfaRequiredError } from '@/lib/invite/acceptErrorMessage'
import { useResetOnBfcacheRestore } from '@/lib/hooks/useResetOnBfcacheRestore'
import { MFA_CHALLENGE_PATH } from '@/lib/auth/mfa'
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
  const [mfaRequired, setMfaRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [sessionEmail, setSessionEmail] = useState<string | null>(null)
  const [emailMismatch, setEmailMismatch] = useState(false)

  // 受諾成功後は window.location.assign() がページを破棄するまで loading を維持し続ける設計
  // （二重送信防止）だが、iPhone Safari 等が bfcache からこのページをそのまま復元すると
  // ページは破棄されておらず、ボタンが永久に押せなくなる。
  // 招待の受諾は取り消せない（受諾済みトークンで再送信すると「招待リンクが無効です」に
  // なる）ため、loading を戻すだけでは古い（受諾前の）画面のまま再操作させてしまう。
  // reload() してこのページ自身の実際の状態（= 招待は既に使用済み）から作り直す
  useResetOnBfcacheRestore(() => window.location.reload())

  // password state を閉じ込めない（呼び出し側から引数で渡す）。閉じ込めると
  // 1文字入力するたびにこの useCallback の参照が変わり、これに依存する下の
  // 招待読み込み用 useEffect まで毎回再実行されてしまう（getSession/rpc_validate_invite の
  // 再発行・パスワード入力中に再検証が走る不具合の原因だった）
  const acceptInvite = useCallback(async (isAutoAccept: boolean, passwordArg?: string) => {
    setLoading(true)
    setError('')
    setMfaRequired(false)

    try {
      if (!isAutoAccept && (!passwordArg || passwordArg.length < 8)) {
        setError('パスワードは8文字以上で入力してください')
        setLoading(false)
        return
      }

      // サーバーサイドで受諾（新規ユーザー作成はサーバー側で招待メールのアドレスを使って行う）
      const response = await fetch(`/api/invites/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: isAutoAccept ? undefined : JSON.stringify({ password: passwordArg }),
      })
      const data = await response.json()

      if (!response.ok) {
        setError(describeAcceptInviteError(data, 'エラーが発生しました'))
        setMfaRequired(isMfaRequiredError(data))
        setLoading(false)
        return
      }

      if (!isAutoAccept) {
        const supabase = createClient()
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: data.email,
          password: passwordArg as string,
        })

        if (signInError) {
          setError(signInError.message)
          setLoading(false)
          return
        }
      }

      // 受諾後の着地は role で分岐（client / vendor は内部レイアウトに入れないため、
      // それぞれ専用のポータルへ）。
      // サインイン識別が変わりうる（新規アカウント作成／別アカウントからの参加）ため、SPA遷移では
      // なくフルページ遷移で終える。フルリロードしても IDB に永続化された ['orgMemberships', uid]
      // は普通に復元される（＝「まだ増えた所属を知らない」古いキャッシュが一度は戻ってくる）ため
      // 無害なのはリロードそのものの効果ではなく、ActiveOrgProvider の staleTime 判定が理由:
      // dataUpdatedAt がこのページ読み込み開始時刻（PAGE_LOADED_AT）より前のデータは常に stale 扱い
      // され、React Query が即座に取り直す（src/lib/org/ActiveOrgProvider.tsx）。
      // （以前は invalidateQueries で個別に手当てしていたが、フル遷移なら PAGE_LOADED_AT 判定に
      // 任せられるので不要）
      if (data.role === 'client') {
        window.location.assign('/portal')
      } else if (data.role === 'vendor') {
        window.location.assign('/vendor-portal')
      } else {
        window.location.assign(`/${data.org_id}/project/${data.space_id}`)
      }
    } catch (err) {
      console.error('Accept error:', err)
      setError('エラーが発生しました')
      setLoading(false)
    }
  }, [token])

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
    // 既存ユーザー（is_existing_user）はここに到達する時点で必ずログイン済み（未ログインなら
    // 前段の「ログインして参加」カードで止まる）。パスワード欄自体が無いため、自動受諾に失敗
    // した後の手動再試行はパスワード確認なしの自動受諾パスで再試行する（誤って
    // 「パスワードは8文字以上」を出さない）
    if (inviteInfo?.is_existing_user) {
      await acceptInvite(true)
    } else {
      await acceptInvite(false, password)
    }
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
        title="招待リンクが無効です"
        description="招待リンクの有効期限が切れたか、既に使用済みです。"
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 bg-red-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            プロジェクト担当者に再招待を依頼してください。既に参加済みの場合はログインしてください。
          </p>
          <div className="flex flex-col gap-3">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              ログインページへ
            </Link>
          </div>
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
          onClick={() => signOutAndLeave({ to: window.location.href })}
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
          <svg className="animate-spin h-8 w-8 text-amber-500" viewBox="0 0 24 24">
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
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600">
            <strong>{inviteInfo.inviter_name || '管理者'}</strong> さんから
            <br />
            <strong>{inviteInfo.space_name}</strong> に招待されました。
          </p>
        </div>
        <p className="mb-4 text-sm text-gray-600">
          <strong>{inviteInfo.email}</strong> は既にアカウントをお持ちです。ログインして参加してください。
        </p>
        <AuthButton
          type="button"
          onClick={() => router.push(`/login?redirect=/invite/${token}`)}
        >
          ログインして参加
        </AuthButton>
      </AuthCard>
    )
  }

  return (
    <AuthCard title={`${inviteInfo.org_name} に招待されました`}>
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
            {mfaRequired && (
              <>
                {' '}
                <Link href={MFA_CHALLENGE_PATH} className="underline">
                  認証アプリのコードを入力する
                </Link>
              </>
            )}
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
          {inviteInfo.is_existing_user ? '参加する' : 'アカウントを作成して参加'}
        </AuthButton>
      </form>
    </AuthCard>
  )
}
