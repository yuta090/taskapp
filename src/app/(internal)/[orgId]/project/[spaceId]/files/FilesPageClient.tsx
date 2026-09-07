'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  FolderOpen,
  Plus,
  File,
  FileImage,
  FilePdf,
  FileDoc,
  FileCsv,
  Table,
  Trash,
  Link as LinkIcon,
  DownloadSimple,
  UploadSimple,
  MagnifyingGlass,
  X as XIcon,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Breadcrumb, useConfirmDialog } from '@/components/shared'
import { FileDescriptionInput } from '@/components/files/FileDescriptionInput'
import { CLIENT } from '@/lib/design/tokens'
import { isTabularFile } from '@/lib/table/tableModel'
import {
  getFileKind,
  filterFiles,
  countActiveFileFilters,
  isFileClientVisible,
  EMPTY_FILE_FILTERS,
  FILE_KIND_OPTIONS,
  FILE_VISIBILITY_OPTIONS,
  FILE_ORIGIN_OPTIONS,
  type FileFilterState,
} from '@/lib/files/filters'
import { formatFileDate } from '@/lib/files/format'
import { FILES_LIST_LIMIT } from '@/lib/files/limits'
import {
  useFiles,
  useUploadFile,
  useUpdateFile,
  useDeleteFile,
  formatFileSize,
  type ProjectFile,
} from '@/lib/hooks/useFiles'

// API側の上限(src/app/api/files/upload-url/route.ts の MAX_FILE_SIZE_BYTES)と揃える
const MAX_FILE_SIZE_BYTES = 52428800

const SELECT_CLASS =
  'text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-surface text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500'

interface FilesPageClientProps {
  orgId: string
  spaceId: string
}

/** アイコンは絞り込みの「種類」と同じ判定を使う(見た目と絞り込み結果を食い違わせない) */
function getFileIcon(name: string, mimeType: string) {
  switch (getFileKind(name, mimeType)) {
    case 'table':
      return FileCsv
    case 'image':
      return FileImage
    case 'pdf':
      return FilePdf
    case 'document':
      return FileDoc
    default:
      return File
  }
}

export function FilesPageClient({ orgId, spaceId }: FilesPageClientProps) {
  const { data: files, isLoading } = useFiles(spaceId)
  const uploadFile = useUploadFile()
  const updateFile = useUpdateFile()
  const deleteFile = useDeleteFile()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadingNames, setUploadingNames] = useState<string[]>([])
  const [filters, setFilters] = useState<FileFilterState>(EMPTY_FILE_FILTERS)

  // 説明文のその場編集。編集中の1行だけ input に差し替える。
  // 書きかけの文字は FileDescriptionInput の中だけで持つ(ここに置くと1打鍵ごとに全行を作り直す)
  const [editingFileId, setEditingFileId] = useState<string | null>(null)

  const basePath = `/${orgId}/project/${spaceId}`

  const handleFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return

      for (const file of Array.from(fileList)) {
        if (file.size > MAX_FILE_SIZE_BYTES) {
          toast.error(`「${file.name}」は50MBを超えているためアップロードできません`)
          continue
        }
        setUploadingNames((prev) => [...prev, file.name])
        try {
          await uploadFile.mutateAsync({ spaceId, file })
          toast.success(`「${file.name}」をアップロードしました`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : `「${file.name}」のアップロードに失敗しました`)
        } finally {
          setUploadingNames((prev) => prev.filter((n) => n !== file.name))
        }
      }
    },
    [spaceId, uploadFile]
  )

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    void handleFiles(e.target.files)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    void handleFiles(e.dataTransfer.files)
  }

  const handleToggleVisible = (file: ProjectFile) => {
    if (file.origin === 'client') return
    updateFile.mutate({ spaceId, fileId: file.id, clientVisible: !file.clientVisible })
  }

  const handleCopyLink = async (file: ProjectFile) => {
    const url = `${window.location.origin}/api/files/${file.id}/download`
    await navigator.clipboard.writeText(url)
    toast.success('リンクをコピーしました。Wikiに貼り付けるとファイルリンクになります')
  }

  const handleDelete = async (file: ProjectFile) => {
    const ok = await confirm({
      title: 'ファイルを削除',
      message: 'このファイルは完全に削除されます。この操作は取り消せません。',
      confirmLabel: '削除',
      variant: 'danger',
    })
    if (!ok) return
    try {
      await deleteFile.mutateAsync({ spaceId, fileId: file.id })
      toast.success('ファイルを削除しました')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'ファイルの削除に失敗しました')
    }
  }

  const startEditDescription = useCallback((fileId: string) => {
    setEditingFileId(fileId)
  }, [])

  const commitDescription = useCallback(
    (fileId: string, description: string | null) => {
      setEditingFileId(null)
      updateFile.mutate({ spaceId, fileId, description })
    },
    [spaceId, updateFile]
  )

  const cancelEditDescription = useCallback(() => setEditingFileId(null), [])

  const updateFilters = (patch: Partial<FileFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const activeFilterCount = countActiveFileFilters(filters)
  const totalCount = files?.length ?? 0
  const visibleFiles = useMemo(() => filterFiles(files ?? [], filters), [files, filters])

  const isAtListLimit = totalCount >= FILES_LIST_LIMIT
  const isEmpty = !isLoading && uploadingNames.length === 0 && totalCount === 0
  const isFilteredEmpty = !isLoading && totalCount > 0 && visibleFiles.length === 0

  return (
    <div
      className="flex-1 flex flex-col min-h-0 relative"
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <FolderOpen className="text-lg text-gray-500 flex-shrink-0" />
          <Breadcrumb items={[{ label: 'プロジェクト', href: basePath }, { label: 'ファイル' }]} />
        </div>
        <div className="ml-auto flex-shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            data-testid="files-input"
            onChange={handleFileInputChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="text-sm" weight="bold" />
            アップロード
          </button>
        </div>
      </header>

      {/* Filter bar — ファイルが1つもないうちは出さない(空の画面に操作だけ並ぶのを避ける) */}
      {totalCount > 0 && (
        <div className="flex items-center gap-2 flex-wrap px-5 py-2 border-b border-gray-100 flex-shrink-0">
          <div className="relative flex items-center">
            <MagnifyingGlass className="absolute left-2 text-sm text-gray-400 pointer-events-none" />
            <input
              type="text"
              data-testid="files-search"
              value={filters.search}
              onChange={(e) => updateFilters({ search: e.target.value })}
              placeholder="ファイル名・説明で検索..."
              aria-label="ファイルを検索"
              className="w-44 md:w-60 pl-7 pr-7 py-1.5 text-xs border border-gray-200 rounded-lg bg-surface placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
            />
            {filters.search && (
              <button
                type="button"
                onClick={() => updateFilters({ search: '' })}
                aria-label="検索をクリア"
                className="absolute right-2 text-gray-400 hover:text-gray-600"
              >
                <XIcon className="text-xs" />
              </button>
            )}
          </div>

          <select
            data-testid="files-filter-kind"
            aria-label="種類でしぼる"
            value={filters.kind}
            onChange={(e) => updateFilters({ kind: e.target.value as FileFilterState['kind'] })}
            className={SELECT_CLASS}
          >
            {FILE_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            data-testid="files-filter-visibility"
            aria-label="公開状態でしぼる"
            value={filters.visibility}
            onChange={(e) => updateFilters({ visibility: e.target.value as FileFilterState['visibility'] })}
            className={SELECT_CLASS}
          >
            {FILE_VISIBILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <select
            data-testid="files-filter-origin"
            aria-label="提供元でしぼる"
            value={filters.origin}
            onChange={(e) => updateFilters({ origin: e.target.value as FileFilterState['origin'] })}
            className={SELECT_CLASS}
          >
            {FILE_ORIGIN_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>

          <span data-testid="files-count" className="text-xs text-gray-400 ml-auto">
            {activeFilterCount > 0 ? `${visibleFiles.length}件 / 全${totalCount}件` : `全${totalCount}件`}
          </span>

          {/* 黙って切り捨てると「探しているファイルが無い」のか「隠れている」のか分からなくなる */}
          {isAtListLimit && (
            <span data-testid="files-limit-notice" className="text-xs text-amber-600">
              新しい順に{FILES_LIST_LIMIT}件まで表示しています
            </span>
          )}

          {activeFilterCount > 0 && (
            <button
              type="button"
              data-testid="files-filter-clear"
              onClick={() => setFilters(EMPTY_FILE_FILTERS)}
              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
            >
              条件をクリア
            </button>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
        {isDragging && (
          <div className="absolute inset-0 z-10 bg-blue-50/80 border-2 border-dashed border-blue-300 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-blue-600 font-medium">ここにドロップしてアップロード</p>
          </div>
        )}

        <div className="content-wrap py-4">
          {isLoading && <div className="text-center text-gray-400 py-16">読み込み中...</div>}

          {isEmpty && (
            <div className="text-center text-gray-400 py-20">
              <FolderOpen className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm mb-1">ファイルはまだありません</p>
              <p className="text-xs">
                「アップロード」ボタンから追加するか、ここにドラッグ&ドロップしてください
              </p>
            </div>
          )}

          {isFilteredEmpty && (
            <div className="text-center text-gray-400 py-20">
              <MagnifyingGlass className="text-4xl mx-auto mb-3 opacity-50" />
              <p className="text-sm mb-1">条件に合うファイルがありません</p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILE_FILTERS)}
                className="text-xs text-blue-600 hover:underline"
              >
                条件をクリアして全件を見る
              </button>
            </div>
          )}

          {!isLoading && (uploadingNames.length > 0 || visibleFiles.length > 0) && (
            <div className="border-t border-gray-100">
              {uploadingNames.map((name) => (
                <div
                  key={`uploading-${name}`}
                  className="row-h flex items-center gap-3 px-4 border-b border-gray-100 text-gray-400"
                >
                  <UploadSimple className="text-lg animate-pulse flex-shrink-0" />
                  <span className="flex-1 min-w-0 truncate text-sm">{name}</span>
                  <span className="text-xs flex-shrink-0">アップロード中...</span>
                </div>
              ))}

              {visibleFiles.map((file) => {
                const FileIcon = getFileIcon(file.name, file.mimeType)
                const isClientVisible = isFileClientVisible(file)
                const tableHref = isTabularFile(file.name, file.mimeType) ? `${basePath}/files/${file.id}` : null
                const isEditing = editingFileId === file.id

                return (
                  <div
                    key={file.id}
                    data-testid="file-row"
                    className="group px-4 py-1.5 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-h-[34px]">
                      <FileIcon className="text-lg text-gray-400 flex-shrink-0" />

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
                        {/* 説明がまだ無い行だけ。ふだんは隠して、カーソルを合わせたときに出す
                            (行の高さが変わらないよう、名前と同じ行に置く) */}
                        {!file.description && !isEditing && (
                          <button
                            type="button"
                            data-testid={`file-description-edit-${file.id}`}
                            onClick={() => startEditDescription(file.id)}
                            // モバイルはホバーが無いので常時表示、デスクトップだけカーソルを合わせたときに出す
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
                          onClick={() => handleToggleVisible(file)}
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
                        onClick={() => handleCopyLink(file)}
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
                        onClick={() => handleDelete(file)}
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
                          onCommit={(value) => commitDescription(file.id, value)}
                          onCancel={cancelEditDescription}
                        />
                      </div>
                    ) : (
                      file.description && (
                        <button
                          type="button"
                          data-testid={`file-description-${file.id}`}
                          onClick={() => startEditDescription(file.id)}
                          title="クリックして説明を編集"
                          className="block w-full pl-8 pr-2 pb-1 text-left text-xs text-gray-500 truncate hover:text-gray-700"
                        >
                          {file.description}
                        </button>
                      )
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {ConfirmDialog}
    </div>
  )
}
