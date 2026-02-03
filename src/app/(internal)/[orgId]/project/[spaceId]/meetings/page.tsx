import { MeetingsPageClient } from './MeetingsPageClient'
import { use } from 'react'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function MeetingsPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return <MeetingsPageClient orgId={orgId} spaceId={spaceId} />
}
