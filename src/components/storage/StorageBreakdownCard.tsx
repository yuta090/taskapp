'use client'

import Link from 'next/link'
import { HardDrives } from '@phosphor-icons/react'
import { useOrgStorageUsage } from '@/lib/hooks/useStorageUsage'
import { formatFileSize } from '@/lib/files/format'

interface StorageBreakdownCardProps {
  orgId?: string
  /** 内訳（プロジェクト名つき）は組織のオーナーにだけ出す。API も同じ条件で絞っている */
  isOwner: boolean
}

/** 「プランと請求」のディスク使用量の内訳。どのプロジェクトがどれだけ使っているか。 */
export function StorageBreakdownCard({ orgId, isOwner }: StorageBreakdownCardProps) {
  const { data, isPending, error } = useOrgStorageUsage(orgId, isOwner)
  if (!isOwner) return null

  const maxBytes = Math.max(1, ...(data?.spaces.map((s) => s.bytes) ?? []), data?.chat_attachments_bytes ?? 0)

  return (
    <div className="bg-surface rounded-lg border border-gray-200 p-6" data-testid="storage-breakdown">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <HardDrives className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900">ディスク使用量の内訳</h3>
        </div>
        {data && (
          <span className="text-sm font-medium text-gray-900">合計 {formatFileSize(data.total_bytes)}</span>
        )}
      </div>

      {isPending && <p className="text-sm text-gray-400">読み込み中...</p>}
      {error && <p className="text-sm text-red-600">ディスク使用量を読み込めませんでした</p>}

      {data && (
        <ul className="space-y-3">
          {data.spaces.map((s) => (
            <UsageRow
              key={s.space_id}
              label={
                <Link
                  href={`/${orgId}/project/${s.space_id}/files`}
                  className="text-gray-700 hover:text-indigo-600 hover:underline truncate"
                >
                  {s.name}
                </Link>
              }
              bytes={s.bytes}
              detail={`${formatFileSize(s.bytes)}（${s.file_count}件）`}
              maxBytes={maxBytes}
            />
          ))}
          {data.chat_attachments_bytes > 0 && (
            <UsageRow
              label={<span className="text-gray-700">チャットの添付ファイル</span>}
              bytes={data.chat_attachments_bytes}
              detail={formatFileSize(data.chat_attachments_bytes)}
              maxBytes={maxBytes}
            />
          )}
          {data.spaces.length === 0 && data.chat_attachments_bytes === 0 && (
            <li className="text-sm text-gray-500">まだファイルはありません</li>
          )}
        </ul>
      )}
    </div>
  )
}

function UsageRow({
  label,
  bytes,
  detail,
  maxBytes,
}: {
  label: React.ReactNode
  bytes: number
  detail: string
  maxBytes: number
}) {
  return (
    <li className="space-y-1">
      <div className="flex justify-between gap-4 text-sm">
        {label}
        <span className="text-gray-900 font-medium flex-shrink-0">{detail}</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${(bytes / maxBytes) * 100}%` }} />
      </div>
    </li>
  )
}
