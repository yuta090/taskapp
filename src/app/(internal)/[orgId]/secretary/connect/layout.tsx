import { ChannelRail } from '@/components/secretary/ChannelRail'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgId: string }>
}

/**
 * 「つなぐ」ハブのレイアウト — /{orgId}/secretary/connect/**
 *
 * 2カラム [左: チャネルレール | 右: route別コンテンツ] にする。
 * チャネルレールはレジストリ駆動。LINEは専用route(/connect/line, /connect/line/groups)、
 * その他のチャット系は汎用の /connect/[channel] セットアップページを持つ。
 * PLANNED(messenger)はレールの「近日」行として提示のみ(routeは持たない)。
 * activeChannel は渡さない（ChannelRail が現在routeから導出＝多チャネル対応）。
 *
 * タブ(SecretaryTabNav)は親の secretary/layout.tsx が一元的に持つ。ここではレールのみ。
 * 配下の各 page(UserLinksClient/GroupLinksClient) は自前でタブを描画しない（二重nav禁止）。
 */
export default async function ConnectLayout({ children, params }: Props) {
  const { orgId } = await params
  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <ChannelRail orgId={orgId} />
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
