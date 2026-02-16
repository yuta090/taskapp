import { Suspense } from 'react'
import InboxClient from './InboxClient'

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-gray-400">読み込み中...</div>}>
      <InboxClient />
    </Suspense>
  )
}
