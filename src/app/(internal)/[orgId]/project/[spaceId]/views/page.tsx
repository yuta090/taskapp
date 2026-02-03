import { redirect } from 'next/navigation'
import { use } from 'react'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function ViewsPage({ params }: Props) {
  const { orgId, spaceId } = use(params)

  // Redirect to Gantt chart by default
  redirect(`/${orgId}/project/${spaceId}/views/gantt`)
}
