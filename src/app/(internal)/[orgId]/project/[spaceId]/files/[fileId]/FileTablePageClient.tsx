'use client'

import { Table, DownloadSimple, ArrowCounterClockwise } from '@phosphor-icons/react'
import { Breadcrumb, LoadingState } from '@/components/shared'
import { DataTableView } from '@/components/table/DataTableView'
import { useFiles } from '@/lib/hooks/useFiles'
import { formatFileSize } from '@/lib/files/format'
import { AnnouncementBell } from '@/components/announcement/AnnouncementBell'
import { useFileTable } from '@/lib/hooks/useFileTable'

interface FileTablePageClientProps {
  orgId: string
  spaceId: string
  fileId: string
}

/**
 * ファイル→表ビュー(読み取り専用)。
 * - ファイル名・サイズは一覧(useFiles)のキャッシュから引く(一覧→表の遷移で追加待ちなし)
 * - 中身は useFileTable で取得し、ブラウザ側で表に変換する
 * - 開けないとき(大きすぎる・形式違い)は理由と「ダウンロード」の逃げ道を出す
 */
export function FileTablePageClient({ orgId, spaceId, fileId }: FileTablePageClientProps) {
  const basePath = `/${orgId}/project/${spaceId}`
  const { data: files } = useFiles(spaceId)
  const file = files?.find((f) => f.id === fileId)
  const { data, isPending, error, refetch } = useFileTable(fileId)
  // ベースライン(TasksPageClient)と同じ判定。isLoading は通信停止中(オフライン等)に false になり
  // 「読み込み中でもエラーでも表でもない空画面」になるため使わない
  const isLoading = isPending && !data

  const downloadHref = `/api/files/${fileId}/download`

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Table className="text-lg text-gray-500 flex-shrink-0" />
          <Breadcrumb
            items={[
              { label: 'プロジェクト', href: basePath },
              { label: 'ファイル', href: `${basePath}/files` },
              { label: file?.name ?? '表' },
            ]}
          />
        </div>
        <div className="ml-auto flex items-center gap-3 flex-shrink-0 text-xs text-gray-400">
          {file && <span className="hidden sm:inline">{formatFileSize(file.sizeBytes)}</span>}
          {data?.encoding === 'shift_jis' && (
            <span className="hidden sm:inline" title="UTF-8 として読めなかったため Shift_JIS として読み込みました">
              Shift_JIS で読み込み
            </span>
          )}
          <a
            href={downloadHref}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <DownloadSimple className="text-sm" />
            ダウンロード
          </a>
          {/* お知らせベル。ヘッダーの一番右に置く。この目印(data-header-bell)があると、
              AppShell がページ上部に出す「ベルだけの1行」が globals.css の :has() で消える。
              モバイルは AppShell のヘッダーにベルがあるので md 未満では出さない。 */}
          <div data-header-bell className="hidden md:block">
            <AnnouncementBell />
          </div>
        </div>
      </header>

      {/* Body */}
      {isLoading && <LoadingState />}
      {!isLoading && error && (
        <div className="text-center py-16">
          <p className="text-sm text-red-600">{error.message}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => void refetch()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <ArrowCounterClockwise className="text-sm" />
              再試行
            </button>
            <a
              href={downloadHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-700 bg-surface border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <DownloadSimple className="text-sm" />
              保存して手元で開く
            </a>
          </div>
        </div>
      )}
      {!isLoading && !error && data && <DataTableView data={data.table} />}
    </div>
  )
}
