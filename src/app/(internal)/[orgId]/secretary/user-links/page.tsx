import { Suspense } from 'react'
import { UserLinksClient } from './UserLinksClient'

interface Props {
  params: Promise<{
    orgId: string
  }>
}

export default async function SecretaryUserLinksPage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <UserLinksClient orgId={orgId} />
    </Suspense>
  )
}
