import { Suspense } from 'react'
import { UserLinksClient } from './UserLinksClient'

interface Props {
  params: Promise<{ orgId: string }>
}

/**
 * /{orgId}/secretary/connect/line — LINEチャネルの連携ハブ(自分/相手先/グループ)。
 * タブ・チャネルレールは connect/layout.tsx が持つ。
 */
export default async function ConnectLinePage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <UserLinksClient orgId={orgId} />
    </Suspense>
  )
}
