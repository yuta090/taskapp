import { Suspense, use } from 'react'
import { BurndownPageClient } from './BurndownPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function BurndownPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400">読み込み中...</div>}>
      <BurndownPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
