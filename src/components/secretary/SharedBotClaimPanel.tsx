'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Copy, Check, Warning } from '@phosphor-icons/react'
import { useUserSpaces } from '@/lib/hooks/useUserSpaces'
import { getChannel } from '@/lib/channels/registry'

interface SharedBotClaimPanelProps {
  orgId: string
  /** google_chat / discord 等の platform 共有Botチャネル */
  channel: string
}

interface IssuedCode {
  code: string
  expiresAt: string
}

/** チャネル別の案内文（つなぎ方ステップ・投稿指示・Pro文言・相手先の呼称）。 */
interface ClaimGuide {
  steps: React.ReactNode
  /** 発行済みコードの上に出す投稿指示 */
  postInstruction: string
  /** Pro 必須(402)時の見出し */
  proLabel: string
  /** 有効期限メモの相手先呼称（スペース/チャンネル 等） */
  targetNoun: string
}

const CLAIM_GUIDES: Record<string, ClaimGuide> = {
  google_chat: {
    steps: (
      <>
        <li>運営のGoogle Chatアプリを、相手先のスペースに追加してもらいます。</li>
        <li>
          <strong>Workspace管理者が権限を一度だけ承認</strong>してもらう必要があります
          （これが無いとメッセージを受け取れません）。
        </li>
        <li>
          下で合言葉を発行し、スペースで<strong>@bot をメンションして</strong>合言葉を投稿してもらいます
          （承認前は@メンション宛のメッセージしか届きません）。内部で承認すると、以降の会話の記録が始まります。
        </li>
      </>
    ),
    postInstruction: 'このコードをGoogle Chatのスペースで@botメンションと一緒に投稿してください。',
    proLabel: 'Google Chat との接続は Pro プランで使えます。',
    targetNoun: 'スペース',
  },
  discord: {
    steps: (
      <>
        <li>運営の共有Bot（agentpm）を、相手先の Discord サーバーに招待してもらいます（招待済みならスキップ）。</li>
        <li>下で合言葉を発行し、記録したい<strong>チャンネルにこの合言葉を投稿</strong>してもらいます。</li>
        <li>
          投稿されると<strong>「確認待ち」</strong>に現れます。内部で承認すると、以降そのチャンネルの会話の記録が始まります。
        </li>
      </>
    ),
    postInstruction: 'このコードを Discord の記録したいチャンネルに投稿してください。',
    proLabel: 'Discord との接続は Pro プランで使えます。',
    targetNoun: 'チャンネル',
  },
}

// 案内文を持たないチャネルの安全なフォールバック（挙動は保つ・チャネル名だけ差し込む）。
function fallbackGuide(channel: string): ClaimGuide {
  const label = getChannel(channel)?.label ?? channel
  return {
    steps: (
      <>
        <li>運営の共有Botを、相手先の{label}に追加してもらいます。</li>
        <li>下で合言葉を発行し、記録したい{label}のチャンネルに投稿してもらいます。</li>
        <li>「確認待ち」に現れるので、内部で承認すると会話の記録が始まります。</li>
      </>
    ),
    postInstruction: `このコードを ${label} の記録したいチャンネルに投稿してください。`,
    proLabel: `${label} との接続は Pro プランで使えます。`,
    targetNoun: 'チャンネル',
  }
}

/**
 * platform 共有Bot（google_chat / discord 等）の接続パネル。
 *
 * これらは org が認証情報を登録せず、合言葉（web_approval コード）を発行 → 相手先チャネルに投稿 →
 * 「確認待ち」で内部承認、という共通フローで紐付ける。発行APIは channel 対応済みの
 * POST /api/channels/group-claims/issue（body: {orgId, spaceId, channel}）。承認/却下は
 * channel 非依存の既存 route（/api/channels/group-claims/pending, /approval）がそのまま拾う。
 * チャネル固有の案内文だけ CLAIM_GUIDES で差し替える（ロジック・見た目は共通）。
 */
export function SharedBotClaimPanel({ orgId, channel }: SharedBotClaimPanelProps) {
  const guide = CLAIM_GUIDES[channel] ?? fallbackGuide(channel)
  const { spaces } = useUserSpaces()
  const orgSpaces = spaces.filter((s) => s.orgId === orgId)

  const [selectedSpaceId, setSelectedSpaceId] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issued, setIssued] = useState<IssuedCode | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Pro専有(external_chat_channels_required)と相手先スペース数上限(group_limit_reached)は
  // 通常エラーと別扱い(アップグレード導線)にするため、それぞれ専用stateで持つ。
  const [proRequired, setProRequired] = useState(false)
  const [groupLimitReached, setGroupLimitReached] = useState(false)

  const issue = async () => {
    if (!selectedSpaceId) return
    setIssuing(true)
    setError(null)
    setProRequired(false)
    setGroupLimitReached(false)
    try {
      const res = await fetch('/api/channels/group-claims/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, spaceId: selectedSpaceId, channel }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 402 && json.code === 'external_chat_channels_required') {
          setProRequired(true)
          return
        }
        if (res.status === 402 && json.code === 'group_limit_reached') {
          setGroupLimitReached(true)
          return
        }
        throw new Error(json.error ?? '合言葉の発行に失敗しました')
      }
      // 平文はこの一度きり。画面を離れたら二度と表示できない
      setIssued({ code: json.code, expiresAt: json.expiresAt })
      setCopied(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : '合言葉の発行に失敗しました')
    } finally {
      setIssuing(false)
    }
  }

  const copy = async () => {
    if (!issued) return
    await navigator.clipboard.writeText(issued.code)
    setCopied(true)
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">つなぎ方</h2>
      <ol className="mb-6 list-decimal list-inside space-y-2 text-sm text-gray-700">{guide.steps}</ol>

      <h2 className="text-sm font-semibold text-gray-700 mb-2">合言葉の発行</h2>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {proRequired && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800">{guide.proLabel}</p>
          <p className="mt-1 text-xs text-amber-700">
            <Link href="/settings/billing" className="underline hover:text-amber-800">
              プランを見る
            </Link>
          </p>
        </div>
      )}

      {groupLimitReached && (
        <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="text-xs text-amber-800">接続できる相手先スペース数の上限に達しています。</p>
          <p className="mt-1 text-xs text-amber-700">
            <Link href="/settings/billing" className="underline hover:text-amber-800">
              プランを見る
            </Link>
          </p>
        </div>
      )}

      {issued ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold text-amber-900">{guide.postInstruction}</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 rounded border border-amber-200 bg-white px-3 py-2 font-mono text-sm tracking-wider text-gray-900">
              {issued.code}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'コピー済み' : 'コピー'}
            </button>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-amber-900">
            <li>・有効期限は30分です。1{guide.targetNoun}のみ紐付けできます。</li>
            <li>・この画面を離れると再表示できません（再発行してください）。</li>
          </ul>
          <button
            type="button"
            onClick={() => setIssued(null)}
            className="mt-3 text-xs text-gray-500 underline hover:no-underline"
          >
            別の合言葉を発行する
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {orgSpaces.length === 0 ? (
            <p className="text-xs text-gray-500">プロジェクトがありません。</p>
          ) : (
            <>
              <select
                value={selectedSpaceId}
                onChange={(e) => setSelectedSpaceId(e.target.value)}
                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="">プロジェクトを選択</option>
                {orgSpaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!selectedSpaceId || issuing}
                onClick={() => void issue()}
                className="rounded bg-amber-500 px-4 py-2 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {issuing ? '発行中...' : '合言葉を発行'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
