import { FileTablePageClient } from './FileTablePageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
    fileId: string
  }>
}

/** ファイル(.csv/.tsv)を表として見るページ。読み取り専用。 */
export default async function FileTablePage({ params }: Props) {
  const { orgId, spaceId, fileId } = await params
  return <FileTablePageClient orgId={orgId} spaceId={spaceId} fileId={fileId} />
}
