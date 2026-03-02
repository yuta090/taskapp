import { Suspense } from 'react'
import MyTasksClient from './MyTasksClient'

export default function MyTasksPage() {
  return (
    <Suspense fallback={<div className="text-center text-gray-400 py-16">読み込み中...</div>}>
      <MyTasksClient />
    </Suspense>
  )
}
