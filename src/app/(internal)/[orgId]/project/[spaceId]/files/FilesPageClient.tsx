'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { FolderOpen, Plus, UploadSimple, MagnifyingGlass, X as XIcon } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { Breadcrumb, useConfirmDialog } from '@/components/shared'
import { FileRow } from '@/components/files/FileRow'
import {
  filterFiles,
  countActiveFileFilters,
  toServerFileQuery,
  hasServerSearchableCondition,
  EMPTY_FILE_FILTERS,
  FILE_KIND_OPTIONS,
  FILE_VISIBILITY_OPTIONS,
  FILE_ORIGIN_OPTIONS,
  type FileFilterState,
} from '@/lib/files/filters'
import { FILES_LIST_LIMIT } from '@/lib/files/limits'
import { useDebouncedValue } from '@/lib/hooks/useDebouncedValue'
import {
  useFiles,
  useFileSearch,
  useUploadFile,
  useUpdateFile,
  useDeleteFile,
} from '@/lib/hooks/useFiles'

// API側の上限(src/app/api/files/upload-url/route.ts の MAX_FILE_SIZE_BYTES)と揃える
const MAX_FILE_SIZE_BYTES = 52428800
// 打鍵のたびにサーバーへ問い合わせないための待ち時間
const SEARCH_DEBOUNCE_MS = 350

const SELECT_CLASS =
  'text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-surface text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500'

interface FilesPageClientProps {
  orgId: string
  spaceId: string
}

export function FilesPageClient({ orgId, spaceId }: FilesPageClientProps) {
  const { data: files, isLoading, hasMore: hasHiddenFiles } = useFiles(spaceId)
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

  // FileRow は memo なので、渡すハンドラは毎回同じ参照でなければ意味がない。
  // 依存には mutation オブジェクトではなく .mutate / .mutateAsync を置く
  // (オブジェクトは実行状態が変わるたびに作り直されるため)
  const updateFileMutate = updateFile.mutate
  const deleteFileMutateAsync = deleteFile.mutateAsync

  const handleToggleVisible = useCallback(
    (fileId: string, nextVisible: boolean) => {
      updateFileMutate({ spaceId, fileId, clientVisible: nextVisible })
    },
    [spaceId, updateFileMutate]
  )

  const handleCopyLink = useCallback(async (fileId: string) => {
    const url = `${window.location.origin}/api/files/${fileId}/download`
    await navigator.clipboard.writeText(url)
    toast.success('リンクをコピーしました。Wikiに貼り付けるとファイルリンクになります')
  }, [])

  const handleDelete = useCallback(
    async (fileId: string) => {
      const ok = await confirm({
        title: 'ファイルを削除',
        message: 'このファイルは完全に削除されます。この操作は取り消せません。',
        confirmLabel: '削除',
        variant: 'danger',
      })
      if (!ok) return
      try {
        await deleteFileMutateAsync({ spaceId, fileId })
        toast.success('ファイルを削除しました')
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'ファイルの削除に失敗しました')
      }
    },
    [spaceId, deleteFileMutateAsync, confirm]
  )

  const startEditDescription = useCallback((fileId: string) => {
    setEditingFileId(fileId)
  }, [])

  const commitDescription = useCallback(
    (fileId: string, description: string | null) => {
      setEditingFileId(null)
      updateFileMutate({ spaceId, fileId, description })
    },
    [spaceId, updateFileMutate]
  )

  const cancelEditDescription = useCallback(() => setEditingFileId(null), [])

  const updateFilters = (patch: Partial<FileFilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const activeFilterCount = countActiveFileFilters(filters)
  const totalCount = files?.length ?? 0

  /**
   * 上限を超えるスペースだけ、絞り込みをサーバーに投げる。
   * 上限内なら手元の一覧に全部そろっているので、問い合わせずに絞るほうが速い。
   */
  const settledFilters = useDebouncedValue(filters, SEARCH_DEBOUNCE_MS)
  const serverQuery = useMemo(() => toServerFileQuery(settledFilters), [settledFilters])
  const useServerSearch = hasHiddenFiles && hasServerSearchableCondition(settledFilters)
  const search = useFileSearch(spaceId, serverQuery, { enabled: useServerSearch })

  // サーバーの結果にも手元の絞り込みを重ねてかける
  // (SQL 側は取りこぼさない超集合なので、正確な種類判定はここで効かせる)
  const searchResults = search.data
  const visibleFiles = useMemo(
    () => filterFiles(useServerSearch ? (searchResults ?? []) : (files ?? []), filters),
    [useServerSearch, searchResults, files, filters]
  )

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
            {useServerSearch
              ? `${visibleFiles.length}件`
              : activeFilterCount > 0
                ? `${visibleFiles.length}件 / 全${totalCount}件`
                : `全${totalCount}件`}
          </span>

          {/* 黙って切り捨てると「探しているファイルが無い」のか「隠れている」のか分からなくなる */}
          {hasHiddenFiles && !useServerSearch && (
            <span data-testid="files-limit-notice" className="text-xs text-amber-600">
              新しい順に{FILES_LIST_LIMIT}件まで表示しています（検索すると古いものも探せます）
            </span>
          )}

          {/* 待っている間の hasMore は「前の結果(＝全件一覧)」のものなので出さない
              (出すと検索のたびに必ず一瞬点滅する) */}
          {useServerSearch && search.hasMore && !search.isPlaceholderData && (
            <span data-testid="files-search-truncated" className="text-xs text-amber-600">
              該当が多すぎます。もう少し絞ってください
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
              {useServerSearch && (
                <p className="text-xs mb-2">古いファイルも含めて探しましたが、見つかりませんでした</p>
              )}
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

              {visibleFiles.map((file) => (
                <FileRow
                  key={file.id}
                  file={file}
                  basePath={basePath}
                  isEditing={editingFileId === file.id}
                  onToggleVisible={handleToggleVisible}
                  onCopyLink={handleCopyLink}
                  onDelete={handleDelete}
                  onStartEditDescription={startEditDescription}
                  onCommitDescription={commitDescription}
                  onCancelEditDescription={cancelEditDescription}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {ConfirmDialog}
    </div>
  )
}
