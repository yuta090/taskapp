'use client'

import { useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Folder,
  File,
  FileDoc,
  FileImage,
  FilePdf,
  Trash,
  Spinner,
  UploadSimple,
} from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'
import { useConfirmDialog } from '@/components/shared'
import { formatFileSize } from '@/lib/files/format'
import { useUploadFile, useDeleteFile, type ProjectFile } from '@/lib/hooks/useFiles'

// API側の上限(src/app/api/files/upload-url/route.ts の MAX_FILE_SIZE_BYTES)と揃える
const MAX_FILE_SIZE_BYTES = 52428800

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface PortalFilesClientProps {
  currentProject: Project
  projects: Project[]
  files: ProjectFile[]
  currentUserId: string
  actionCount?: number
}

function getFileIcon(mimeType: string) {
  if (mimeType.includes('image')) return FileImage
  if (mimeType.includes('pdf')) return FilePdf
  if (mimeType.includes('doc') || mimeType.includes('word')) return FileDoc
  return File
}

export function PortalFilesClient({
  currentProject,
  projects,
  files,
  currentUserId,
  actionCount = 0,
}: PortalFilesClientProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadFile = useUploadFile()
  const deleteFile = useDeleteFile()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const handleUploadClick = () => fileInputRef.current?.click()

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return

      if (file.size > MAX_FILE_SIZE_BYTES) {
        toast.error(`「${file.name}」は50MBを超えているためアップロードできません`)
        return
      }

      try {
        await uploadFile.mutateAsync({ spaceId: currentProject.id, file })
        toast.success('ファイルをアップロードしました。チームに通知されます')
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'アップロードに失敗しました')
      }
    },
    [currentProject.id, uploadFile, router]
  )

  const handleDelete = useCallback(
    async (file: ProjectFile) => {
      const ok = await confirm({
        title: 'ファイルを削除しますか?',
        message: `「${file.name}」を削除します。この操作は取り消せません。`,
        confirmLabel: '削除する',
        variant: 'danger',
      })
      if (!ok) return

      try {
        await deleteFile.mutateAsync({ spaceId: currentProject.id, fileId: file.id })
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'ファイルの削除に失敗しました')
      }
    },
    [currentProject.id, deleteFile, router, confirm]
  )

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Page Header */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">ファイル</h1>
              <p className="mt-1 text-sm text-gray-600">
                プロジェクトの共有ファイルを確認できます
              </p>
            </div>
            <div className="flex-shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                data-testid="portal-files-input"
                onChange={handleFileSelected}
              />
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={uploadFile.isPending}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors"
              >
                {uploadFile.isPending ? (
                  <Spinner className="animate-spin" />
                ) : (
                  <UploadSimple />
                )}
                {uploadFile.isPending ? 'アップロード中...' : 'ファイルをアップロード'}
              </button>
            </div>
          </div>

          {/* File List */}
          {files.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <Folder className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">ファイルはまだありません</p>
              <p className="text-sm text-gray-400 mt-1">
                チームからの共有ファイルや、あなたがアップロードした資料がここに表示されます
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-100">
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.mimeType)
                  const isOwn = file.uploadedBy === currentUserId
                  return (
                    <div
                      key={file.id}
                      className="px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3"
                    >
                      <FileIcon className="w-8 h-8 text-gray-400 shrink-0" />
                      <a
                        href={`/api/files/${file.id}/download`}
                        className="flex-1 min-w-0"
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate min-w-0">
                            {file.name}
                          </span>
                          {isOwn && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded font-medium shrink-0">
                              あなたがアップロード
                            </span>
                          )}
                        </span>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(file.sizeBytes)} • {new Date(file.createdAt).toLocaleDateString('ja-JP')}
                        </p>
                      </a>
                      {isOwn && (
                        <button
                          type="button"
                          data-testid={`file-delete-${file.id}`}
                          onClick={() => handleDelete(file)}
                          disabled={deleteFile.isPending}
                          title="削除"
                          aria-label={`${file.name} を削除`}
                          className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                        >
                          <Trash className="text-sm" />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {ConfirmDialog}
    </PortalShell>
  )
}
