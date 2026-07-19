import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'
import { ChannelRail } from '@/components/secretary/ChannelRail'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgId: string }>
}

/**
 * 「つなぐ」ハブのレイアウト — /{orgId}/secretary/connect/**
 *
 * 上部に秘書コンソールの共通タブ(SecretaryTabNav・activeTab="connect")、
 * その下を2カラム [左: チャネルレール | 右: route別コンテンツ] にする。
 * チャネルレールはレジストリ駆動。LINEは専用route(/connect/line, /connect/line/groups)、
 * その他のチャット系は汎用の /connect/[channel] セットアップページを持つ。
 * PLANNED(messenger)はレールの「近日」行として提示のみ(routeは持たない)。
 *
 * 配下の各 page(UserLinksClient/GroupLinksClient) は自前でタブを描画しない
 * （二重nav禁止）。タブ・レールはこのレイアウトが一元的に持つ。
 */
export default async function ConnectLayout({ children, params }: Props) {
  const { orgId } = await params
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SecretaryTabNav orgId={orgId} activeTab="connect" />
      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <ChannelRail orgId={orgId} />
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </div>
  )
}
