'use client'

import { memo } from 'react'
import Link from 'next/link'
import {
  File,
  FileImage,
  FilePdf,
  FileDoc,
  FileCsv,
  Table,
  Trash,
  Link as LinkIcon,
  DownloadSimple,
} from '@phosphor-icons/react'
import { CLIENT } from '@/lib/design/tokens'
import { isTabularFile } from '@/lib/table/tableModel'
import { getFileKind, isFileClientVisible } from '@/lib/files/filters'
import { formatFileDate } from '@/lib/files/format'
import { formatFileSize, type ProjectFile } from '@/lib/hooks/useFiles'
import { FileDescriptionInput } from './FileDescriptionInput'

interface FileRowProps {
  file: ProjectFile
  /** `/{orgId}/project/{spaceId}` */
  basePath: string
  isEditing: boolean
  onToggleVisible: (fileId: string, nextVisible: boolean) => void
  onCopyLink: (fileId: string) => void
  onDelete: (fileId: string) => void
  onStartEditDescription: (fileId: string) => void
  onCommitDescription: (fileId: string, description: string | null) => void
  onCancelEditDescription: () => void
}

const FILE_ICON_CLASS = 'text-lg text-gray-400 flex-shrink-0'

/** アイコンは絞り込みの「種類」と同じ判定を使う(見た目と絞り込み結果を食い違わせない) */
function FileTypeIcon({ name, mimeType }: { name: string; mimeType: string }) {
  switch (getFileKind(name, mimeType)) {
    case 'table':
      return <FileCsv className={FILE_ICON_CLASS} />
    case 'image':
      return <FileImage className={FILE_ICON_CLASS} />
    case 'pdf':
      return <FilePdf className={FILE_ICON_CLASS} />
    case 'document':
      return <FileDoc className={FILE_ICON_CLASS} />
    default:
      return <File className={FILE_ICON_CLASS} />
  }
}

function FileRowInner({
  file,
  basePath,
  isEditing,
  onToggleVisible,
  onCopyLink,
  onDelete,
  onStartEditDescription,
  onCommitDescription,
  onCancelEditDescription,
}: FileRowProps) {
  const isClientVisible = isFileClientVisible(file)
  const tableHref = isTabularFile(file.name, file.mimeType) ? `${basePath}/files/${file.id}` : null

  return (
    <div
      data-testid="file-row"
      className="group px-4 py-1.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-3 min-h-[34px]">
        <FileTypeIcon name={file.name} mimeType={file.mimeType} />

        <div className="flex-1 min-w-0 flex items-center gap-2">
          {tableHref ? (
            <Link
              href={tableHref}
              className="text-sm font-medium text-gray-900 truncate hover:text-indigo-600 hover:underline underline-offset-2"
            >
              {file.name}
            </Link>
          ) : (
            <span className="text-sm font-medium text-gray-900 truncate">{file.name}</span>
          )}
          {file.origin === 'client' && (
            <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${CLIENT.badge}`}>
              クライアント提供
            </span>
          )}
          {/* 説明がまだ無い行だけ。行の高さが変わらないよう名前と同じ行に置く。
              モバイルはホバーが無いので常時表示、デスクトップだけカーソルを合わせたときに出す */}
          {!file.description && !isEditing && (
            <button
              type="button"
              data-testid={`file-description-edit-${file.id}`}
              onClick={() => onStartEditDescription(file.id)}
              className="flex-shrink-0 text-[11px] text-gray-400 hover:text-gray-600 hover:underline transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
            >
              説明を追加
            </button>
          )}
        </div>

        <div className="hidden sm:block flex-shrink-0 text-xs text-gray-400 w-16 text-right">
          {formatFileSize(file.sizeBytes)}
        </div>

        <div className="hidden lg:block flex-shrink-0 text-xs text-gray-400 w-20 truncate">
          {file.uploaderName}
        </div>

        <div className="hidden md:block flex-shrink-0 text-xs text-gray-400 w-16">
          {formatFileDate(file.createdAt)}
        </div>

        {/* クライアント公開トグル */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          <span className={`hidden xl:inline text-[10px] ${isClientVisible ? CLIENT.accent : 'text-gray-400'}`}>
            {isClientVisible ? '公開中' : '非公開'}
          </span>
          <button
            type="button"
            data-testid={`file-visibility-toggle-${file.id}`}
            onClick={() => onToggleVisible(file.id, !file.clientVisible)}
            disabled={file.origin === 'client'}
            title={
              file.origin === 'client'
                ? 'クライアント提供ファイルは常時公開されます'
                : isClientVisible
                  ? 'クリックしてクライアント非公開にする'
                  : 'クリックしてクライアント公開にする'
            }
            className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-60 ${
              isClientVisible ? CLIENT.dot : 'bg-gray-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-surface rounded-full shadow transition-transform ${
                isClientVisible ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {tableHref && (
          <Link
            href={tableHref}
            data-testid={`file-open-table-${file.id}`}
            title="表で見る"
            className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <Table className="text-sm" />
          </Link>
        )}

        <button
          type="button"
          data-testid={`file-copy-link-${file.id}`}
          onClick={() => onCopyLink(file.id)}
          title="リンクをコピー"
          className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <LinkIcon className="text-sm" />
        </button>

        <a
          href={`/api/files/${file.id}/download`}
          title="ダウンロード"
          className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <DownloadSimple className="text-sm" />
        </a>

        <button
          type="button"
          data-testid={`file-delete-${file.id}`}
          onClick={() => onDelete(file.id)}
          title="ファイルを削除"
          className="flex-shrink-0 p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
        >
          <Trash className="text-sm" />
        </button>
      </div>

      {/* 説明文 — 名前の下。押すとその場で書き換えられる(保存ボタンは置かない) */}
      {isEditing ? (
        <div className="pl-8 pr-2 pb-1">
          <FileDescriptionInput
            testId={`file-description-input-${file.id}`}
            initialValue={file.description ?? ''}
            onCommit={(value) => onCommitDescription(file.id, value)}
            onCancel={onCancelEditDescription}
          />
        </div>
      ) : (
        file.description && (
          <button
            type="button"
            data-testid={`file-description-${file.id}`}
            onClick={() => onStartEditDescription(file.id)}
            title="クリックして説明を編集"
            className="block w-full pl-8 pr-2 pb-1 text-left text-xs text-gray-500 truncate hover:text-gray-700"
          >
            {file.description}
          </button>
        )
      )}
    </div>
  )
}

/** 検索1文字ごとに全行が作り直されないよう memo 化。props は全て安定参照で渡すこと。 */
export const FileRow = memo(FileRowInner)
