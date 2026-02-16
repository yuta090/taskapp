import { Suspense, use } from 'react'
import { MeetingsPageClient } from './MeetingsPageClient'

interface Props {
  params: Promise<{
    orgId: string
    spaceId: string
  }>
}

export default function MeetingsPage({ params }: Props) {
  const { orgId, spaceId } = use(params)
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400">読み込み中...</div>}>
      <MeetingsPageClient orgId={orgId} spaceId={spaceId} />
    </Suspense>
  )
}
