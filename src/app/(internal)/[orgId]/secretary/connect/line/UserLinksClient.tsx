'use client'

import { useState } from 'react'
import { SelfLinkPanel } from '@/components/secretary/SelfLinkPanel'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'
import { DirectConnectDisclosure } from '@/components/secretary/DirectConnectDisclosure'
import { SharedLineUsagePanel } from '@/components/secretary/SharedLineUsagePanel'
import { ChannelCommandGuide } from '@/components/secretary/ChannelCommandGuide'
import { resolveLineBotOwnership } from '@/components/secretary/botProfilePlacement'
import type { LineSelfServeState } from '@/lib/channels/sharedBotAccess'

/**
 * LINE連携ハブ — /{orgId}/secretary/connect/line
 *
 * 共通LINE(共有Bot)は per-org の利用状態(lineAccess・サーバ側で解決して prop で渡る)で出し分ける（申込制）:
 *  - own / granted        → メリット1文 → 1. 自分のLINEをつなぐ → 2. グループLINEをつなぐ → 補助情報
 *  - none                 → メリット1文 → 「利用を申し込む」ボタン（POST でき次第 requested に遷移）
 *  - requested            → 申込受付済み・開通待ち
 *  - unavailable          → 準備中（開通したらメールでお知らせ）
 * 未申込/申込中の org はパネルを出さない（発行APIは 403 だが、UIでも dead-end を作らない）。
 *
 * バックエンド（identity突合・コード発行API・トークン）は一切変えない。各パネルは既存
 * コンポーネントを呼ぶだけ。タブ・チャネルレールは connect/layout.tsx が持つ。
 */
export function UserLinksClient({
  orgId,
  lineAccess,
}: {
  orgId: string
  lineAccess: LineSelfServeState
}) {
  const [access, setAccess] = useState<LineSelfServeState>(lineAccess)
  const [requesting, setRequesting] = useState(false)

  const onRequest = async () => {
    setRequesting(true)
    try {
      const res = await fetch('/api/onboarding/shared-bot-access/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      if (res.ok) {
        const json = (await res.json()) as { access?: LineSelfServeState }
        setAccess(json.access ?? 'requested')
      }
    } finally {
      setRequesting(false)
    }
  }

  // 状態に関わらず、冒頭は「つなぐと何ができるか」1文で始める（つなぎ方の話から始めない）。
  const header = (
    <div className="space-y-1">
      <h1 className="text-sm font-semibold text-gray-900">LINE秘書につなぐ</h1>
      <p data-testid="line-connect-lead" className="text-xs text-gray-600">
        つなぐと、グループLINEの会話が自動でタスクになり、期限のお知らせや承認もLINEで受け取れます。
      </p>
    </div>
  )

  // 開通済み（or 自社bot）: 番号付き2ステップ → 補助情報の順。
  if (access === 'own' || access === 'granted') {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {header}

          {/* ステップ1は自分のLINE。ここだけで完結し、承認（本人しかできない）の前提にもなる。 */}
          <section data-testid="line-step-self" className="rounded border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">1. 自分のLINEをつなぐ</h2>
            <p className="mt-1 text-xs text-gray-500">承認や期限のお知らせが、あなたのLINEに届くようになります。</p>
            <div className="mt-3">
              <SelfLinkPanel orgId={orgId} />
            </div>
          </section>

          {/* ステップ2はグループ。手順・QR・コード発行・承認は専用画面に集約してあるので、ここはボタンだけ。 */}
          <section data-testid="line-step-group" className="rounded border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">2. 相手先とのグループLINEをつなぐ</h2>
            <p className="mt-1 text-xs text-gray-500">
              グループにLINE秘書を招待すると、そこでの決めごと・お願いが自動でタスクになります。
            </p>
            <div className="mt-3">
              <GroupLinkPanel orgId={orgId} />
            </div>
            <DirectConnectDisclosure orgId={orgId} />
          </section>

          {/* 補助情報は後ろに。LINE は ChannelConnectOverview を通らないので使い方の案内はここに置く。
              貼り先は「秘書のアカウントを誰が持っているか」で変わる（共通LINEのプロフィール欄は
              当社が持っていて事務所の方は編集できない）ので、利用状態から解決して渡す。 */}
          <ChannelCommandGuide channel="line" botOwnership={resolveLineBotOwnership(access)} />
          <SharedLineUsagePanel orgId={orgId} />
        </div>
      </div>
    )
  }

  // 未申込/申込中/準備中: つなぎ方は出さず、いま何をすればよいか（or 待てばよいか）だけを出す。
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {header}

        {access === 'none' && (
          <section className="rounded border border-amber-300 bg-amber-50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">まずは利用を申し込む</h2>
            <p className="text-xs text-gray-700">申し込むと当社が開通し、ご登録のメールでお知らせします。</p>
            <button
              type="button"
              onClick={onRequest}
              disabled={requesting}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-100 hover:bg-gray-800 disabled:opacity-50"
            >
              {requesting ? '送信中…' : '利用を申し込む'}
            </button>
          </section>
        )}

        {access === 'requested' && (
          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">申込を受け付けました。開通したら、ご登録のメールでお知らせします。</p>
          </section>
        )}

        {access === 'unavailable' && (
          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              準備中です。開通したら、ご登録のメールでお知らせします（お急ぎの場合はサポートへご連絡ください）。
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
