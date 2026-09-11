import { FilesPageClient } from './FilesPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function FilesPage({ params }: Props) {
  const { orgId, spaceId } = await params
  return <FilesPageClient orgId={orgId} spaceId={spaceId} />
}
