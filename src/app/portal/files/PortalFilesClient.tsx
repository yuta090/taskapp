'use client'

import { Folder, File, FileDoc, FileImage, FilePdf } from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface FileItem {
  id: string
  name: string
  type: string
  size: number
  createdAt: string
}

interface PortalFilesClientProps {
  currentProject: Project
  projects: Project[]
  files: FileItem[]
  actionCount?: number
}

function getFileIcon(type: string) {
  if (type.includes('image')) return FileImage
  if (type.includes('pdf')) return FilePdf
  if (type.includes('doc') || type.includes('word')) return FileDoc
  return File
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

export function PortalFilesClient({
  currentProject,
  projects,
  files,
  actionCount = 0,
}: PortalFilesClientProps) {
  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ファイル</h1>
            <p className="mt-1 text-sm text-gray-600">
              プロジェクトの共有ファイルを確認できます
            </p>
          </div>

          {/* File List */}
          {files.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <Folder className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600">ファイルはまだありません</p>
              <p className="text-sm text-gray-400 mt-1">
                チームがファイルを共有すると、ここに表示されます
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-gray-100">
                {files.map((file) => {
                  const FileIcon = getFileIcon(file.type)
                  return (
                    <div
                      key={file.id}
                      className="px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3"
                    >
                      <FileIcon className="w-8 h-8 text-gray-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatFileSize(file.size)} • {new Date(file.createdAt).toLocaleDateString('ja-JP')}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </PortalShell>
  )
}
