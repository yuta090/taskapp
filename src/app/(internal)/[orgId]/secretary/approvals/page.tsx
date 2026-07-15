import { Suspense } from 'react'
import { ApprovalsClient } from './ApprovalsClient'

interface Props {
  params: Promise<{ orgId: string }>
}

export default async function ApprovalsPage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <ApprovalsClient orgId={orgId} />
    </Suspense>
  )
}
