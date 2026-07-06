'use client'

import { useCallback, useRef, useState } from 'react'
import {
  FolderOpen,
  Plus,
  File,
  FileImage,
  FilePdf,
  FileDoc,
  Trash,
  Link as LinkIcon,
  DownloadSimple,
  UploadSimple,
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Breadcrumb, useConfirmDialog } from '@/components/shared'
import { CLIENT } from '@/lib/design/tokens'
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

interface FilesPageClientProps {
  orgId: string
  spaceId: string
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('image')) return FileImage
  if (mimeType.includes('pdf')) return FilePdf
  if (mimeType.includes('word') || mimeType.includes('document')) return FileDoc
  return File
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

  const isEmpty = !isLoading && uploadingNames.length === 0 && (!files || files.length === 0)

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

          {!isLoading && (uploadingNames.length > 0 || (files && files.length > 0)) && (
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

              {files?.map((file) => {
                const FileIcon = getFileIcon(file.mimeType)
                const isClientVisible = file.clientVisible || file.origin === 'client'

                return (
                  <div
                    key={file.id}
                    data-testid="file-row"
                    className="row-h flex items-center gap-3 px-4 border-b border-gray-100 hover:bg-gray-50 transition-colors"
                  >
                    <FileIcon className="text-lg text-gray-400 flex-shrink-0" />

                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span className="text-sm font-medium text-gray-900 truncate">{file.name}</span>
                      {file.origin === 'client' && (
                        <span className={`flex-shrink-0 inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${CLIENT.badge}`}>
                          クライアント提供
                        </span>
                      )}
                    </div>

                    <div className="hidden sm:block flex-shrink-0 text-xs text-gray-400 w-16 text-right">
                      {formatFileSize(file.sizeBytes)}
                    </div>

                    <div className="hidden lg:block flex-shrink-0 text-xs text-gray-400 w-20 truncate">
                      {file.uploaderName}
                    </div>

                    <div className="hidden md:block flex-shrink-0 text-xs text-gray-400 w-16">
                      {new Date(file.createdAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
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
                          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                            isClientVisible ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>

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
