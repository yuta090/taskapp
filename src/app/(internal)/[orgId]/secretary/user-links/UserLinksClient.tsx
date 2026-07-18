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

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <section>
          <h1 className="text-sm font-semibold text-gray-900">LINE秘書につなぐ</h1>
          <p className="mt-1 text-xs text-gray-500">
            用途に合わせて3つの連携から選んでください。いずれも「友だち追加しただけでは連携されません。
            コードを送信して初めて連携が完了します」。
          </p>
        </section>

        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">自分をつなぐ（承認をLINEで受け取る）</h2>
          <p className="mt-1 text-xs text-gray-500">
            いつ使う: 申し送りの承認・確認依頼を自分のLINEで受け取りたいとき。
          </p>
          <div className="mt-4">
            <SelfLinkPanel orgId={orgId} />
          </div>
        </section>

        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">顧問先をつなぐ（やりとり・依頼をLINEで）</h2>
          <p className="mt-1 text-xs text-gray-500">
            いつ使う: 顧問先とのメッセージ・依頼をLINEでやり取りしたいとき。
          </p>
          <div className="mt-4">
            <ClientLinkPanel orgId={orgId} />
          </div>
        </section>

        <section className="rounded border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-900">グループをつなぐ（顧問先グループの申し送り）</h2>
          <p className="mt-1 text-xs text-gray-500">
            いつ使う: 顧問先とのLINEグループでのやり取りを申し送りとして取り込みたいとき。
          </p>
          <div className="mt-4">
            <GroupLinkPanel orgId={orgId} />
          </div>
        </section>
      </div>
    </div>
  )
}
