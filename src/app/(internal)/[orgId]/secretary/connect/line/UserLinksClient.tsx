'use client'

import { useState } from 'react'
import { SelfLinkPanel } from '@/components/secretary/SelfLinkPanel'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'
import { DirectConnectDisclosure } from '@/components/secretary/DirectConnectDisclosure'
import { SharedLineUsagePanel } from '@/components/secretary/SharedLineUsagePanel'
import { Hint } from '@/components/secretary/Hint'
import { ChannelCommandGuide } from '@/components/secretary/ChannelCommandGuide'
import { resolveLineBotOwnership } from '@/components/secretary/botProfilePlacement'
import type { LineSelfServeState } from '@/lib/channels/sharedBotAccess'

/**
 * LINE連携ハブ — /{orgId}/secretary/connect/line
 *
 * 共通LINE(共有Bot)は per-org の利用状態(lineAccess・サーバ側で解決して prop で渡る)で出し分ける（申込制）:
 *  - own / granted        → 連携パネル（グループLINEの会話をタスクにする / 承認や通知を自分のLINEで受け取る）
 *  - none                 → 「共通LINEを申し込む」ボタン（POST でき次第 requested に遷移）
 *  - requested            → 申込受付済み・当社の開通待ち
 *  - unavailable          → 準備中（当社が順次開通・メールでご案内）
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

  // 開通済み（or 自社bot）: 従来の連携パネル。
  if (access === 'own' || access === 'granted') {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-1">
            <h1 className="text-sm font-semibold text-gray-900">LINE秘書につなぐ</h1>
            <p className="text-xs text-gray-500">
              つなぎ方は2つあります。相手先とのグループLINEをつなぐと会話がタスクになり、自分のLINEをつなぐと承認や通知が届きます。
            </p>
          </div>

          <SharedLineUsagePanel orgId={orgId} />

          {/* LINE は ChannelConnectOverview を通らないので、使い方の案内はここに置く。
              貼り先は「秘書のアカウントを誰が持っているか」で変わる。共通LINEのプロフィール欄は
              当社が持っていて事務所の方は編集できないので、利用状態から解決して渡す。 */}
          <ChannelCommandGuide channel="line" botOwnership={resolveLineBotOwnership(access)} />

          <section className="rounded border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">
              グループLINEの会話をタスクにする
              <Hint label="グループLINEをつなぐ">
                いつも使っているグループLINEにLINE秘書を招待すると、そこでの決めごと・お願いを秘書が自動でタスクにします。グループを新しく作り直す必要はありません。
              </Hint>
            </h2>
            <div className="mt-3">
              <GroupLinkPanel orgId={orgId} />
            </div>
            <DirectConnectDisclosure orgId={orgId} />
          </section>

          <section className="rounded border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">
              承認や通知を自分のLINEで受け取る
              <Hint label="自分のLINEをつなぐ">
                タスクの承認依頼や期限のお知らせを、あなたのLINEで受け取れます。承認はつないだ本人しかできないため、必ずご自身のLINEでつないでください。
              </Hint>
            </h2>
            <div className="mt-3">
              <SelfLinkPanel orgId={orgId} />
            </div>
          </section>
        </div>
      </div>
    )
  }

  // 未申込/申込中/準備中: パネルは出さず、状態に応じた案内を出す。
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <h1 className="text-sm font-semibold text-gray-900">LINE秘書につなぐ</h1>

        {access === 'none' && (
          <section className="rounded border border-amber-300 bg-amber-50 p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">
              共通LINEの利用を申し込む
              <Hint label="共通LINEの利用申込">
                いつものグループLINEにLINE秘書を招待すると、そこでの決めごと・お願いが自動でタスクになります。ご利用には申込が必要です。
              </Hint>
            </h2>
            <button
              type="button"
              onClick={onRequest}
              disabled={requesting}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-gray-100 hover:bg-gray-800 disabled:opacity-50"
            >
              {requesting ? '送信中…' : '共通LINEを申し込む'}
            </button>
          </section>
        )}

        {access === 'requested' && (
          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              共通LINEの利用申込を受け付けました。開通しましたら、ご登録のメールでご案内します。
            </p>
          </section>
        )}

        {access === 'unavailable' && (
          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              LINE秘書は順番に開通しています。開通しましたら、ご登録のメールでご案内します（お急ぎの場合はサポートへご連絡ください）。
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
