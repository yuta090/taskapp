import { TasksPageClient } from './TasksPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function TasksPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <TasksPageClient orgId={orgId} spaceId={spaceId} />
}
