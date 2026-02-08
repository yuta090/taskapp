'use client'

import dynamic from 'next/dynamic'

export const WikiEditorDynamic = dynamic(
  () => import('./WikiEditor').then(mod => ({ default: mod.WikiEditor })),
  {
    ssr: false,
    loading: () => (
      <div className="h-64 bg-gray-50 rounded-lg animate-pulse flex items-center justify-center">
        <span className="text-sm text-gray-400">エディタを読み込み中...</span>
      </div>
    ),
  }
)
