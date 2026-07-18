'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Check, Warning, LinkBreak } from '@phosphor-icons/react'
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
 * 内部メンバーが自分のLINEを連携するパネル（Stage 2.7-A）。
 *
 * 承認（申し送りを本体タスクへ昇格させる操作）は、この連携が済んでいる本人しか行えない。
 * コードは *自分の分しか* 発行できない（APIがセッションから user_id を導出する）。
 *
 * 元は UserLinksClient のページ本体だったが、連携ハブ（3カード）の1カードとして
 * 再利用するため抽出した（SecretaryTabNav は含めない・挙動は完全に同一）。
 */
export function SelfLinkPanel({ orgId }: { orgId: string }) {
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
    <div className="space-y-4">
      {account && (
        <div className="flex items-start gap-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
          <Check weight="bold" className="w-4 h-4 flex-shrink-0 mt-0.5 text-green-600" />
          <span>「{account.displayName}」は接続済み。あとはあなたのLINEをつなぐだけです。</span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <LineFriendQr orgId={orgId} />
      <p className="text-xs text-gray-500">
        すでに友だち追加済みなら、下のボタンでコードを発行し、秘書との1:1トークに送るだけです。
      </p>

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
          <p className="mt-2 text-[11px] text-amber-900">
            15分で失効・1回のみ。<strong>グループには貼らないでください。</strong>
          </p>
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
              コードを発行してつなぐ
            </button>
          )}
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-gray-900">連携済み</h3>
        {links.length === 0 ? (
          <p className="mt-2 text-xs text-gray-500">まだつないでいません。</p>
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
  )
}
