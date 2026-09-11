import { IntegrationsConsoleClient } from './IntegrationsConsoleClient'

interface Props {
  params: Promise<{
    orgId: string
  }>
}

export default async function SecretaryIntegrationsPage({ params }: Props) {
  const { orgId } = await params
  return <IntegrationsConsoleClient orgId={orgId} />
}
