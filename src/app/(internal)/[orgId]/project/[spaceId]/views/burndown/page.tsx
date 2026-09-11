import { BurndownPageClient } from './BurndownPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function BurndownPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <BurndownPageClient orgId={orgId} spaceId={spaceId} />
}
