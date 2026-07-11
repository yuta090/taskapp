import { Suspense } from 'react'
import { IntegrationsConsoleClient } from './IntegrationsConsoleClient'

interface Props {
  params: Promise<{
    orgId: string
  }>
}

export default async function SecretaryIntegrationsPage({ params }: Props) {
  const { orgId } = await params
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <IntegrationsConsoleClient orgId={orgId} />
    </Suspense>
  )
}
