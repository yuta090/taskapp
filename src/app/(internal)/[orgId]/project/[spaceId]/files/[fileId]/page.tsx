import { Suspense } from 'react'
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
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <FileTablePageClient orgId={orgId} spaceId={spaceId} fileId={fileId} />
    </Suspense>
  )
}
