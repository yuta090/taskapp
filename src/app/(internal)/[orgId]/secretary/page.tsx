import { SecretaryConsoleClient } from './SecretaryConsoleClient'

interface Props {
  params: Promise<{
    orgId: string
  }>
}

export default async function SecretaryPage({ params }: Props) {
  const { orgId } = await params
  return <SecretaryConsoleClient orgId={orgId} />
}
