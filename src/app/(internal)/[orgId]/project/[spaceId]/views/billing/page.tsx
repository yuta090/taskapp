import { BillingPageClient } from './BillingPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function BillingPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <BillingPageClient orgId={orgId} spaceId={spaceId} />
}
