import { ChannelRail } from '@/components/secretary/ChannelRail'

interface Props {
  children: React.ReactNode
  params: Promise<{ orgId: string }>
}

/**
 * 「つなぐ」ハブのレイアウト — /{orgId}/secretary/connect/**
 *
 * 2カラム [左: チャネルレール | 右: route別コンテンツ] にする。
 * 現状つなげるチャネルは LINE のみ(/connect/line, /connect/line/groups)。
 * Slack/Teams は ChannelRail の「近日」行として提示のみ(routeは持たない)。
 *
 * タブ(SecretaryTabNav)は親の secretary/layout.tsx が一元的に持つ。ここではレールのみ。
 * 配下の各 page(UserLinksClient/GroupLinksClient) は自前でタブを描画しない（二重nav禁止）。
 */
export default async function ConnectLayout({ children, params }: Props) {
  const { orgId } = await params
  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <ChannelRail orgId={orgId} activeChannel="line" />
      <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
  )
}
