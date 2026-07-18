'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Warning, LinkBreak } from '@phosphor-icons/react'
import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'
import { LineFriendQr } from '@/components/secretary/LineFriendQr'

interface UserLink {
  id: string
  userId: string
  linkedAt: string
}

interface ChannelAccount {
  id: string
  displayName: string
}

/**
 * 内部メンバーが自分のLINEを連携する画面（Stage 2.7-A）。
 *
 * 承認（申し送りを本体タスクへ昇格させる操作）は、この連携が済んでいる本人しか行えない。
 * コードは *自分の分しか* 発行できない（APIがセッションから user_id を導出する）。
 */
export function UserLinksClient({ orgId }: { orgId: string }) {
  const [account, setAccount] = useState<ChannelAccount | null>(null)
  const [links, setLinks] = useState<UserLink[]>([])
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    const [accountsRes, linksRes] = await Promise.all([
      fetch(`/api/channels/accounts?orgId=${orgId}`),
      fetch(`/api/channels/user-links?orgId=${orgId}`),
    ])
    // /api/channels/accounts は org に1件の account を *単数* で返す（複数形ではない）
    if (accountsRes.ok) setAccount((await accountsRes.json()).account ?? null)
    if (linksRes.ok) setLinks((await linksRes.json()).links ?? [])
  }, [orgId])

  useEffect(() => {
    void reload()
  }, [reload])

  const issue = async (channelAccountId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/channels/user-links/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, channelAccountId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'コードを発行できませんでした')
      // 平文はこの一度きり。画面を離れたら二度と表示できない
      setIssuedCode(json.code)
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'コードを発行できませんでした')
    } finally {
      setLoading(false)
    }
  }

  const revoke = async (linkId: string) => {
    setError(null)
    const res = await fetch('/api/channels/user-links', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId, linkId }),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? '解除できませんでした')
      return
    }
    await reload()
  }

  const copy = async () => {
    if (!issuedCode) return
    await navigator.clipboard.writeText(issuedCode)
    setCopied(true)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SecretaryTabNav orgId={orgId} activeTab="user-links" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-gray-900">LINE連携（本人確認）</h2>
          <p className="mt-1 text-xs text-gray-500">
            候補をタスクとして承認するには、担当者本人のLINEを連携しておく必要があります。
            連携していない場合、承認の依頼はLINEに届きません。
          </p>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <section>
          <h3 className="text-xs font-semibold text-gray-900">① 秘書を友だち追加</h3>
          <p className="mt-1 text-xs text-gray-500">
            まだ秘書を友だち追加していない場合は、下のQRから追加してください。
          </p>
          <div className="mt-2">
            <LineFriendQr orgId={orgId} />
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-gray-900">② コードで連携を完了</h3>
          <p className="mt-1 text-xs text-gray-500">
            下のボタンでコードを発行し、①で追加した秘書とのトークに送信すると連携完了です。
          </p>
        </section>

        {issuedCode ? (
          <section className="rounded border border-amber-300 bg-amber-50 p-4">
            <p className="text-xs font-semibold text-amber-900">
              このコードを、秘書との1:1トークに送ってください
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm tracking-wider text-gray-900">
                {issuedCode}
              </code>
              <button
                type="button"
                onClick={copy}
                className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'コピー済み' : 'コピー'}
              </button>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-amber-900">
              <li>・有効期限は15分です。1回使うと無効になります。</li>
              <li>
                ・<strong>グループには絶対に貼らないでください。</strong>
                貼られた場合は安全のため自動で無効化されます。
              </li>
              <li>・この画面を離れると再表示できません（再発行してください）。</li>
            </ul>
          </section>
        ) : (
          <section className="space-y-2">
            {!account ? (
              <p className="text-xs text-gray-500">
                LINE公式アカウントが登録されていません。先に「連携」タブで設定してください。
              </p>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => issue(account.id)}
                className="rounded bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-50"
              >
                {account.displayName} と自分のLINEを連携する
              </button>
            )}
          </section>
        )}

        <section>
          <h3 className="text-xs font-semibold text-gray-900">連携済み</h3>
          {links.length === 0 ? (
            <p className="mt-2 text-xs text-gray-500">まだ連携されていません。</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-200 rounded border border-gray-200">
              {links.map((link) => (
                <li key={link.id} className="flex items-center justify-between px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-gray-900">{link.userId}</p>
                    <p className="text-[11px] text-gray-500">
                      {new Date(link.linkedAt).toLocaleString('ja-JP')} に連携
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => revoke(link.id)}
                    className="flex items-center gap-1 rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
                  >
                    <LinkBreak className="w-3 h-3" />
                    解除
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
