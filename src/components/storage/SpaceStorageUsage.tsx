'use client'

import Link from 'next/link'
import { HardDrives, ArrowRight } from '@phosphor-icons/react'
import { useSpaceStorageUsage } from '@/lib/hooks/useStorageUsage'
import { formatFileSize } from '@/lib/files/format'

interface SpaceStorageUsageProps {
  orgId: string
  spaceId: string
}

/** プロジェクト設定の「ディスク使用量」。このプロジェクトのファイルが使っている容量。 */
export function SpaceStorageUsage({ orgId, spaceId }: SpaceStorageUsageProps) {
  const { data, isPending, error } = useSpaceStorageUsage(orgId, spaceId)

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-900 mb-1">ディスク使用量</h2>
      <p className="text-xs text-gray-500 mb-4">
        このプロジェクトのファイル一覧に上げたファイルの合計です。組織全体の使用量と上限は「プランと請求」で確認できます。
      </p>

      {isPending && <p className="text-sm text-gray-400">読み込み中...</p>}
      {error && <p className="text-sm text-red-600">ディスク使用量を読み込めませんでした</p>}

      {data && (
        <div className="flex items-center gap-4 rounded-lg border border-gray-200 p-4">
          <HardDrives className="w-8 h-8 text-gray-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-2xl font-semibold text-gray-900">{formatFileSize(data.bytes)}</p>
            <p className="text-sm text-gray-500">ファイル {data.file_count}件</p>
          </div>
          <Link
            href={`/${orgId}/project/${spaceId}/files`}
            className="flex items-center gap-1 text-sm text-indigo-600 hover:underline flex-shrink-0"
          >
            ファイル一覧を開く
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      )}
    </div>
  )
}
