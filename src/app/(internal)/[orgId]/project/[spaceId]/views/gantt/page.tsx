import { Suspense, use } from 'react'
import { GanttPageClient } from './GanttPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function GanttPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400">読み込み中...</div>}>
      <GanttPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
