import { Suspense } from 'react'
import { BillingPageClient } from './BillingPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function BillingPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <BillingPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
