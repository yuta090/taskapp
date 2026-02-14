import { BurndownPageClient } from './BurndownPageClient'
import { use } from 'react'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function BurndownPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return <BurndownPageClient orgId={orgId} spaceId={spaceId} />
}
