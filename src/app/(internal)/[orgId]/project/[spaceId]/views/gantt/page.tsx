import { GanttPageClient } from './GanttPageClient'
import { use } from 'react'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function GanttPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return <GanttPageClient orgId={orgId} spaceId={spaceId} />
}
