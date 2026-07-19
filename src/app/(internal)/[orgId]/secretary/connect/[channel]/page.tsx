import { notFound, redirect } from 'next/navigation'
import { getChannel } from '@/lib/channels/registry'
import { ChannelConnectOverview } from '@/components/secretary/ChannelConnectOverview'

interface Props {
  params: Promise<{ orgId: string; channel: string }>
}

/**
 * /{orgId}/secretary/connect/[channel] — LINE以外のチャネルの汎用セットアップページ。
 *
 * LINE は静的 route(/connect/line)が優先されここには来ない。email/未知チャネルは404。
 * レジストリ駆動なので、registry にチャネルを足すだけでレールのリンク先ページが成立する。
 */
export default async function ConnectChannelPage({ params }: Props) {
  const { orgId, channel } = await params

  // 防御的: 万一 line がここに来たら専用routeへ寄せる
  if (channel === 'line') redirect(`/${orgId}/secretary/connect/line`)

  const def = getChannel(channel)
  if (!def || def.kind !== 'chat') notFound()

  return <ChannelConnectOverview def={def} />
}
