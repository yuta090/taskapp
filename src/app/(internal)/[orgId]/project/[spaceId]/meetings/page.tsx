import { Suspense } from 'react'
import { MeetingsPageClient } from './MeetingsPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function MeetingsPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <MeetingsPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
