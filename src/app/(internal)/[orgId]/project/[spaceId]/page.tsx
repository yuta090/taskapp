import { TasksPageClient } from './TasksPageClient'
import { use } from 'react'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function TasksPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return <TasksPageClient orgId={orgId} spaceId={spaceId} />
}
