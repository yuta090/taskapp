import { Suspense } from 'react'
import { SecretaryConsoleClient } from './SecretaryConsoleClient'

interface Props {
  params: Promise<{
    orgId: string
  }>
}

export default async function SecretaryPage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <SecretaryConsoleClient orgId={orgId} />
    </Suspense>
  )
}
