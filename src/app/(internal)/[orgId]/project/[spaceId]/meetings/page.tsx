import { MeetingsPageClient } from './MeetingsPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function MeetingsPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <MeetingsPageClient orgId={orgId} spaceId={spaceId} />
}
