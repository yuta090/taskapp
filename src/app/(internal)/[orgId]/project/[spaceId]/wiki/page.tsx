import { WikiPageClient } from './WikiPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default async function WikiPage({ params }: Props) {
  const { orgId, spaceId } = await params
  // key: スペースを移動したら検索・絞り込みの状態を持ち越さない
  return <WikiPageClient key={spaceId} orgId={orgId} spaceId={spaceId} />
}
