import { UserLinksClient } from './UserLinksClient'
import { getLineSelfServeState } from '@/lib/channels/store'

interface Props {
  params: Promise<{ orgId: string }>
}

/**
 * /{orgId}/secretary/connect/line — LINEチャネルの連携ハブ(自分/相手先/グループ)。
 * タブ・チャネルレールは connect/layout.tsx が持つ。
 *
 * 共通LINE の per-org 利用状態(lineAccess)をサーバ側で解決して渡す（申込制の出し分け・
 * クライアントでの追加往復を作らない）。読取失敗時は 'unavailable' に倒す（準備中表示）。
 */
export default async function ConnectLinePage({ params }: Props) {
  const { orgId } = await params
  let lineAccess: Awaited<ReturnType<typeof getLineSelfServeState>> = 'unavailable'
  try {
    lineAccess = await getLineSelfServeState(orgId)
  } catch {
    lineAccess = 'unavailable'
  }
  // lineAccess はサーバ側で解決済み・UserLinksClient は suspend しないため Suspense 境界は不要。
  // シェル(タブ/チャネルレール)は connect/layout.tsx が先に描画する。
  return <UserLinksClient orgId={orgId} lineAccess={lineAccess} />
}
