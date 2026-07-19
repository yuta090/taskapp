import { Suspense } from 'react'
import { GroupLinksClient } from './GroupLinksClient'

interface Props {
  params: Promise<{ orgId: string }>
}

/**
 * /{orgId}/secretary/connect/line/groups — LINE共通botのグループ紐付け管理
 * (一括発行・承認待ち)。タブ・チャネルレールは connect/layout.tsx が持つ。
 */
export default async function ConnectLineGroupsPage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <GroupLinksClient orgId={orgId} />
    </Suspense>
  )
}
