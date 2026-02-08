import { WikiPageClient } from './WikiPageClient'
import { use } from 'react'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function WikiPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return <WikiPageClient orgId={orgId} spaceId={spaceId} />
}
