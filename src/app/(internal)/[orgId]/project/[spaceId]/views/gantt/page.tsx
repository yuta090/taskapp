import { GanttPageClient } from './GanttPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function GanttPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <GanttPageClient orgId={orgId} spaceId={spaceId} />
}
