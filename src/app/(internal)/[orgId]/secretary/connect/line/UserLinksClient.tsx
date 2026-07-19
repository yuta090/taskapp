'use client'

import { SelfLinkPanel } from '@/components/secretary/SelfLinkPanel'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'
import { DirectConnectDisclosure } from '@/components/secretary/DirectConnectDisclosure'

/**
 * LINE連携ハブ — /{orgId}/secretary/connect/line
 *
 * やることは2つだけ、を高校生でも分かる言葉で見せる:
 *  ①「グループLINEから拾う」= いつものグループに秘書を入れて会話をタスク化（主役）
 *  ②「自分のLINEで受け取る」= 承認・通知を自分のLINEへ
 * 1対1の個別つなぎ(相手先/ClientLinkPanel)はグループを介さず直接連絡したいとき用の
 * Pro機能なので、①の下に DirectConnectDisclosure として畳んで置く（既定は閉じる）。
 *
 * バックエンド（identity突合・コード発行API・トークン）は一切変えない。各カードは
 * 既存コンポーネントを呼ぶだけ。タブ・チャネルレールは connect/layout.tsx が持つ。
 */
export function UserLinksClient({ orgId }: { orgId: string }) {
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
