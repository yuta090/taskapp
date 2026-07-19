'use client'

import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'
import { SelfLinkPanel } from '@/components/secretary/SelfLinkPanel'
import { ClientLinkPanel } from '@/components/secretary/ClientLinkPanel'
import { GroupLinkPanel } from '@/components/secretary/GroupLinkPanel'

/**
 * LINE連携ハブ — /{orgId}/secretary/user-links
 *
 * 「自分をつなぐ(user-links)」「顧問先をつなぐ(SpaceConnectionList/messages)」
 * 「グループをつなぐ(group-links)」の3系統がタブに分散していて、どれをいつ使うか
 * 分からないという声を受けて、1画面3カードに統合した提示レイヤー（Fable設計 D3）。
 *
 * 3系統のバックエンド（identity突合・コード発行API・トークン）は一切統合しない。
 * 各カードは既存コンポーネントをそのまま呼ぶだけ（SelfLinkPanel/ClientLinkPanel/
 * GroupLinkPanel）。SecretaryTabNav はここで1回だけ描画する（二重nav禁止）。
 */
export function UserLinksClient({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <SecretaryTabNav orgId={orgId} activeTab="user-links" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <h1 className="text-sm font-semibold text-gray-900">LINE秘書につなぐ</h1>

        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">自分をつなぐ</h2>
          <p className="mt-0.5 text-xs text-gray-500">承認や確認を自分のLINEで受け取る</p>
          <div className="mt-3">
            <SelfLinkPanel orgId={orgId} />
          </div>
        </section>

        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">顧問先をつなぐ</h2>
          <p className="mt-0.5 text-xs text-gray-500">顧問先とのやり取りをLINEで</p>
          <div className="mt-3">
            <ClientLinkPanel orgId={orgId} />
          </div>
        </section>

        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">グループをつなぐ</h2>
          <p className="mt-0.5 text-xs text-gray-500">顧問先グループのやり取りを取り込む</p>
          <div className="mt-3">
            <GroupLinkPanel orgId={orgId} />
          </div>
        </section>
      </div>
    </div>
  )
}
