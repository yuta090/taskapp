import { Suspense } from 'react'
import { DashboardClient } from './DashboardClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function DashboardPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <DashboardClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
