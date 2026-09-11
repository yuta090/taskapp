import { ApprovalsClient } from './ApprovalsClient'

interface Props {
  params: Promise<{ orgId: string }>
}

export default async function ApprovalsPage({ params }: Props) {
  const { orgId } = await params
  return <ApprovalsClient orgId={orgId} />
}
