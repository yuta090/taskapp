import { Suspense } from 'react'
import { WikiPageClient } from './WikiPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function WikiPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <WikiPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
