import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { getClient } from '@/lib/mcp/oauth/store'
import { matchesRegisteredRedirectUri } from '@/lib/mcp/oauth/validation'
import { listConnectableOrgs } from '@/lib/mcp/oauth/consent'

/**
 * 外部チャット（ChatGPT など）からの接続の同意画面。
 *
 * ⚠ 自動で許可しない。「次回から省略」も作らない。つなぎ先の登録は誰でもできるので、
 * 本人がここで名前と戻り先を見て判断することが最後の砦になる。
 * つなぎ先の名前と戻り先は**そのままの文字**で出す（リンクにしない）。
 *
 * ⚠ 入口の指定が不正なときは、戻り先へ飛ばさずこの画面で止める。
 * 飛ばすと、なりすましの戻り先へ手がかりを渡すことになる。
 */
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-gray-200 rounded-lg p-6 max-w-md w-full">
        <h1 className="text-lg font-semibold text-gray-900">接続できません</h1>
        <p className="mt-3 text-sm text-gray-700">{message}</p>
        <p className="mt-4 text-xs text-gray-500">
          つなぎ先のアプリでもう一度やり直してください。何度も出る場合は、そのアプリの設定を見直してください。
        </p>
      </div>
    </div>
  )
}

export default async function OAuthAuthorizePage({ searchParams }: Props) {
  const params = await searchParams

  const clientId = one(params.client_id)
  const redirectUri = one(params.redirect_uri)
  const state = one(params.state)
  const codeChallenge = one(params.code_challenge)
  const codeChallengeMethod = one(params.code_challenge_method)
  const responseType = one(params.response_type) || 'code'

  // ページ自身でもログインを確かめる（門番だけに頼らない）
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    const back = new URLSearchParams(
      Object.entries(params).flatMap(([k, v]) => (v === undefined ? [] : [[k, one(v)] as [string, string]])),
    )
    redirect(`/login?redirect=${encodeURIComponent(`/oauth/authorize?${back.toString()}`)}`)
  }

  if (!clientId) return <ErrorScreen message="つなぎ先の指定がありません。" />

  const client = await getClient(clientId)
  if (!client) return <ErrorScreen message="登録されていないつなぎ先です。" />

  if (!matchesRegisteredRedirectUri(client.redirectUris, redirectUri)) {
    return <ErrorScreen message="戻り先が登録と一致しません。安全のため、ここで止めました。" />
  }
  if (responseType !== 'code') {
    return <ErrorScreen message="この受け取り方には対応していません。" />
  }
  if (codeChallengeMethod !== 'S256' || !codeChallenge) {
    return <ErrorScreen message="つなぎ先が古い方式で接続しようとしています（PKCE S256 が必要です）。" />
  }

  const orgs = await listConnectableOrgs(supabase, user.id)
  if (orgs.length === 0) {
    return (
      <ErrorScreen message="外部チャットにつなげる組織がありません。相手先・協力会社のアカウントからは接続できません。" />
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-surface border border-gray-200 rounded-lg p-6 max-w-md w-full">
        <h1 className="text-lg font-semibold text-gray-900">AgentPM への接続を許可しますか？</h1>

        <dl className="mt-5 space-y-3 text-sm">
          <div>
            <dt className="text-gray-500">つなぎ先</dt>
            {/* リンクにしない。表示名は登録者が自由に付けられるため */}
            <dd className="mt-0.5 font-medium text-gray-900 break-all">{client.clientName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">戻り先</dt>
            <dd className="mt-0.5 text-gray-700 break-all font-mono text-xs">{redirectUri}</dd>
          </div>
        </dl>

        <p className="mt-4 text-xs text-gray-500">
          身に覚えのないつなぎ先や、見慣れない戻り先のときは許可しないでください。
        </p>

        <form action="/api/oauth/consent" method="post" className="mt-6 space-y-5">
          <input type="hidden" name="client_id" value={clientId} />
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />

          <div>
            <label htmlFor="org_id" className="block text-sm font-medium text-gray-900">
              つなぐ組織
            </label>
            <select
              id="org_id"
              name="org_id"
              className="mt-1.5 w-full rounded-md border border-gray-300 bg-surface px-3 py-2 text-sm text-gray-900"
            >
              {orgs.map((o) => (
                <option key={o.orgId} value={o.orgId}>
                  {o.orgName}
                </option>
              ))}
            </select>
            {orgs.length > 1 && (
              <p className="mt-1.5 text-xs text-gray-500">
                1つの接続で見られるのは、選んだ組織だけです。ほかの組織も使うなら、つなぎ先でもう1つ接続を作ってください。
              </p>
            )}
          </div>

          <fieldset>
            <legend className="block text-sm font-medium text-gray-900">できることの範囲</legend>
            <label className="mt-1.5 flex items-start gap-2 text-sm text-gray-700">
              <input type="radio" name="level" value="read" defaultChecked className="mt-1" />
              <span>
                見るだけ
                <span className="block text-xs text-gray-500">タスク・会議・議事録・Wiki を読む</span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm text-gray-700">
              <input type="radio" name="level" value="write" className="mt-1" />
              <span>
                見る＋書く
                <span className="block text-xs text-gray-500">
                  上に加えて、タスクの作成・更新・ボール渡しができる
                </span>
              </span>
            </label>
            <p className="mt-2 text-xs text-gray-500">
              どちらを選んでも、削除・一括変更・承認はできません。接続はいつでも解除できます。
            </p>
          </fieldset>

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              name="decision"
              value="approve"
              className="flex-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
            >
              許可する
            </button>
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 rounded-md border border-gray-300 bg-surface px-4 py-2 text-sm font-medium text-gray-700"
            >
              許可しない
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
