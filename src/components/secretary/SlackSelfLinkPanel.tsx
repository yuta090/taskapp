'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Check, Warning, LinkBreak } from '@phosphor-icons/react'
import { useOrgChannelAccount } from '@/lib/hooks/useOrgChannelAccount'
import { useOrgUserLinks, orgUserLinksQueryKey } from '@/lib/hooks/useOrgUserLinks'
import { SECRETARY_SLACK_BOT_DISPLAY_NAME } from '@/lib/channels/slack/secretaryManifest'

/**
 * 自分の Slack を AgentPM のユーザーに結びつけるカード（LINE の SelfLinkPanel の Slack 版）。
 *
 * これが無いと、Slack のリマインドに付く [完了した] などのボタンを押しても「誰が押したか」が
 * 分からず反応しない（RPC は 口座×Slack user id から本人を解決する）。1対1の DM でリマインドを
 * 受け取るのにも要る。コードは自分の分しか発行できず（API がセッションから user_id を導出）、
 * 秘書への DM に送ると成立する（LINE の 1:1 トークと同じ手順）。
 *
 * 一覧はこの Slack の口座の分だけをサーバー側で絞って取る（LINE の分を転送しない）。
 * 速いページの型: 口座・一覧とも react-query（永続キャッシュ）経由で、口座は同じ画面の
 * 案内/登録フォームとキーを共有（追加通信なし）。一覧の取得中は件数を出さない
 * （「0人」と誤って見せて、つないだ人に再発行させない）。
 */
export function SlackSelfLinkPanel({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient()
  const { data: account } = useOrgChannelAccount(orgId, 'slack')
  const registered = !!account && account.status === 'active'
  const { data: links, isPending: linksPending } = useOrgUserLinks(
    registered ? orgId : undefined,
    account?.id,
  )
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const reload = () => queryClient.invalidateQueries({ queryKey: orgUserLinksQueryKey(orgId, account?.id) })

  const issue = async () => {
    if (!account) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/channels/user-links/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, channelAccountId: account.id }),
      })
      const json = (await res.json()) as { code?: string; error?: string }
      if (!res.ok || !json.code) throw new Error(json.error ?? 'コードを発行できませんでした')
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
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      setError(json.error ?? '解除できませんでした')
      return
    }
    await reload()
  }

  const copy = async () => {
    if (!issuedCode) return
    try {
      await navigator.clipboard.writeText(issuedCode)
      setCopied(true)
    } catch {
      /* クリップボード不可の環境では何もしない */
    }
  }

  const slackLinks = links ?? []

  return (
    <section className="mt-6 rounded-lg border border-gray-200 bg-surface p-4">
      <h2 className="text-sm font-semibold text-gray-900">自分の Slack をつなぐ（本人確認）</h2>
      <p className="mt-1 text-xs text-gray-600">
        リマインドの「完了した」などのボタンを押したり、1対1の DM でリマインドを受け取ったりするには、あなたの Slack
        アカウントと AgentPM のユーザーを一度だけ結びつけます。メンバーそれぞれが自分の分を行ってください。
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!registered ? (
        <p className="mt-3 text-xs text-gray-500">先に上の手順3で鍵を登録してください。登録が済むと、ここでコードを発行できます。</p>
      ) : issuedCode ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-900">
            Slack で秘書アプリ「{SECRETARY_SLACK_BOT_DISPLAY_NAME}」を開き、DM（1対1のメッセージ）にこのコードをそのまま送ってください
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded border border-amber-200 bg-surface px-3 py-2 font-mono text-sm tracking-wider text-gray-900">
              {issuedCode}
            </code>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1 rounded border border-gray-300 bg-surface px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'コピー済み' : 'コピー'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-amber-900">
            有効期限は15分・1回だけ使えます。<strong>チャンネルには貼らないでください</strong>（あなた本人を確認するためのコードです。貼られたコードはその場で無効になります）。
          </p>
        </div>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={issue}
          className="mt-3 rounded bg-gray-900 px-4 py-2 text-xs font-medium text-gray-100 hover:bg-gray-700 disabled:opacity-50"
        >
          コードを発行してつなぐ
        </button>
      )}

      {registered && !(linksPending && !links) && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold text-gray-900">この Slack につないだ人: {slackLinks.length}人</h3>
          {slackLinks.length === 0 ? (
            <p className="mt-1 text-xs text-gray-500">まだ誰もつないでいません。</p>
          ) : (
            <ul className="mt-2 divide-y divide-gray-200 rounded border border-gray-200">
              {slackLinks.map((link) => (
                <li key={link.id} className="flex items-center justify-between px-3 py-2">
                  <p className="text-[11px] text-gray-500">{new Date(link.linkedAt).toLocaleString('ja-JP')} に連携</p>
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
        </div>
      )}
    </section>
  )
}
