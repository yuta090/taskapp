import { Suspense } from 'react'
import { GroupLinksClient } from './GroupLinksClient'

interface Props {
  params: Promise<{ orgId: string }>
}

export default async function GroupLinksPage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <GroupLinksClient orgId={orgId} />
    </Suspense>
  )
}
