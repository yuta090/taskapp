'use client'

import { useState } from 'react'
import { useFiles, type ProjectFile } from '@/lib/hooks/useFiles'
import { formatFileSize } from '@/lib/files/format'

interface WikiFileLinkPickerProps {
  spaceId: string | undefined
  onSelect: (file: ProjectFile) => void
}

/**
 * Wikiエディタから既存のプロジェクトファイルを選んでリンク挿入するためのピッカー。
 * モーダル禁止のUIルールに従い、呼び出し側がインラインパネルとして絶対配置する想定。
 */
export function WikiFileLinkPicker({ spaceId, onSelect }: WikiFileLinkPickerProps) {
  const { data: files, isLoading } = useFiles(spaceId)
  const [showInternalWarning, setShowInternalWarning] = useState(false)

  const handleSelect = (file: ProjectFile) => {
    setShowInternalWarning(!file.clientVisible)
    onSelect(file)
  }

  return (
    <div className="w-72 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg p-2">
      {showInternalWarning && (
        <p className="mb-2 px-2 py-1.5 text-xs text-orange-700 bg-orange-50 rounded">
          社内のみのファイルはクライアントには表示されません(リンクを開けません)
        </p>
      )}
      {isLoading ? (
        <p className="px-2 py-3 text-xs text-gray-400">読み込み中...</p>
      ) : !files || files.length === 0 ? (
        <p className="px-2 py-3 text-xs text-gray-500">
          ファイルはまだありません。プロジェクトのファイルページからアップロードできます
        </p>
      ) : (
        <ul className="space-y-0.5">
          {files.map(file => (
            <li key={file.id}>
              <button
                type="button"
                onClick={() => handleSelect(file)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 rounded transition-colors"
              >
                <span className="flex-1 min-w-0 truncate">{file.name}</span>
                {!file.clientVisible && (
                  <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 bg-gray-100 rounded">
                    社内のみ
                  </span>
                )}
                <span className="shrink-0 text-xs text-gray-400">{formatFileSize(file.sizeBytes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
