import { Suspense } from 'react'
import { GanttPageClient } from './GanttPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function GanttPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <GanttPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
