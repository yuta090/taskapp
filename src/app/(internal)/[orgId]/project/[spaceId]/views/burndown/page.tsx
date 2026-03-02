import { Suspense } from 'react'
import { BurndownPageClient } from './BurndownPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function BurndownPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <BurndownPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
