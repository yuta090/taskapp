'use client'

import { useState } from 'react'
import { SelfLinkPanel } from '@/components/secretary/SelfLinkPanel'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'
import { DirectConnectDisclosure } from '@/components/secretary/DirectConnectDisclosure'
import type { LineSelfServeState } from '@/lib/channels/sharedBotAccess'

/**
 * LINE連携ハブ — /{orgId}/secretary/connect/line
 *
 * 共通LINE(共有Bot)は per-org の利用状態(lineAccess・サーバ側で解決して prop で渡る)で出し分ける（申込制）:
 *  - own / granted        → 連携パネル（グループから拾う / 自分のLINEで受け取る）
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
          <h1 className="text-sm font-semibold text-gray-900">LINE秘書につなぐ</h1>

          <section className="rounded border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">グループLINEから拾う</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              いつものグループLINEに秘書を招待すると、そこでの決めごと・お願いを自動でタスクにします。
            </p>
            <div className="mt-3">
              <GroupLinkPanel orgId={orgId} />
            </div>
            <DirectConnectDisclosure orgId={orgId} />
          </section>

          <section className="rounded border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900">自分のLINEで受け取る</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              承認のお願いやお知らせが、あなたのLINEに届きます。
            </p>
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
            <h2 className="text-sm font-semibold text-gray-900">共通LINEの利用を申し込む</h2>
            <p className="text-xs text-gray-600">
              いつものグループLINEに秘書を入れて、会話の決めごと・お願いを自動でタスクにできます。まずは利用をお申し込みください。お申し込み後、当社が開通してご登録のメールでご案内します。
            </p>
            <button
              type="button"
              onClick={onRequest}
              disabled={requesting}
              className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {requesting ? '送信中…' : '共通LINEを申し込む'}
            </button>
          </section>
        )}

        {access === 'requested' && (
          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              共通LINEの利用申込を受け付けました。当社が開通しましたら、ご登録のメールでご案内します。
            </p>
          </section>
        )}

        {access === 'unavailable' && (
          <section className="rounded border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm text-gray-700">
              LINE秘書は当社にて順次開通しています。開通しましたらご登録のメールでご案内します（お急ぎの場合はサポートへご連絡ください）。
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
