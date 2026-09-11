import { DashboardClient } from './DashboardClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function DashboardPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <DashboardClient orgId={orgId} spaceId={spaceId} />
}
