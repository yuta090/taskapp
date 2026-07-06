import { Suspense } from 'react'
import { FilesPageClient } from './FilesPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function FilesPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <FilesPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
