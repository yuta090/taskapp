'use client'

import { useState, useEffect } from 'react'
import { X, Trash, Clock, Tag, PencilSimple, Check } from '@phosphor-icons/react'
import type { WikiPage, WikiPageVersion } from '@/types/database'

interface WikiPageInspectorProps {
  page: WikiPage
  onClose: () => void
  onUpdate?: (updates: { title?: string; tags?: string[] }) => Promise<void>
  onDelete?: () => Promise<void>
  onFetchVersions?: (pageId: string) => Promise<WikiPageVersion[]>
  onRestoreVersion?: (version: WikiPageVersion) => void
}

export function WikiPageInspector({
  page,
  onClose,
  onUpdate,
  onDelete,
  onFetchVersions,
  onRestoreVersion,
}: WikiPageInspectorProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(page.title)
  const [isDeleting, setIsDeleting] = useState(false)
  const [versions, setVersions] = useState<WikiPageVersion[]>([])
  const [showVersions, setShowVersions] = useState(false)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [tagInput, setTagInput] = useState('')

  // Reset state when page changes — intentional state sync from props
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional state reset when page changes
    setEditTitle(page.title)
    setIsEditingTitle(false)
    setIsDeleting(false)
    setShowVersions(false)
    setVersions([])
  }, [page.id, page.title])

  const handleSaveTitle = async () => {
    if (!onUpdate || !editTitle.trim() || editTitle === page.title) {
      setIsEditingTitle(false)
      setEditTitle(page.title)
      return
    }
    try {
      await onUpdate({ title: editTitle.trim() })
      setIsEditingTitle(false)
    } catch {
      setEditTitle(page.title)
      setIsEditingTitle(false)
    }
  }

  const handleDelete = async () => {
    if (!onDelete) return
    if (!isDeleting) {
      setIsDeleting(true)
      return
    }
    try {
      await onDelete()
    } catch {
      setIsDeleting(false)
    }
  }

  const handleAddTag = async () => {
    const tag = tagInput.trim()
    if (!tag || !onUpdate || page.tags.includes(tag)) {
      setTagInput('')
      return
    }
    try {
      await onUpdate({ tags: [...page.tags, tag] })
    } catch {
      // Error handled by hook
    }
    setTagInput('')
  }

  const handleRemoveTag = async (tagToRemove: string) => {
    if (!onUpdate) return
    try {
      await onUpdate({ tags: page.tags.filter(t => t !== tagToRemove) })
    } catch {
      // Error handled by hook
    }
  }

  const handleToggleVersions = async () => {
    if (showVersions) {
      setShowVersions(false)
      return
    }
    if (onFetchVersions) {
      setLoadingVersions(true)
      try {
        const v = await onFetchVersions(page.id)
        setVersions(v)
      } catch {
        setVersions([])
      }
      setLoadingVersions(false)
    }
    setShowVersions(true)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">ページ情報</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDelete}
            className={`p-1.5 rounded transition-colors ${
              isDeleting
                ? 'text-red-600 bg-red-50 hover:bg-red-100'
                : 'text-gray-400 hover:text-red-500 hover:bg-gray-100'
            }`}
            title={isDeleting ? 'もう一度クリックで削除' : '削除'}
          >
            <Trash className="text-base" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="text-base" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {/* Title */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 block">タイトル</label>
          {isEditingTitle ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveTitle()
                  if (e.key === 'Escape') {
                    setIsEditingTitle(false)
                    setEditTitle(page.title)
                  }
                }}
                className="flex-1 px-2 py-1 text-sm border border-indigo-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                autoFocus
              />
              <button onClick={handleSaveTitle} className="p-1 text-indigo-600 hover:bg-indigo-50 rounded">
                <Check className="text-sm" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsEditingTitle(true)}
              className="w-full text-left flex items-center gap-1 group"
            >
              <span className="text-sm font-medium text-gray-900 truncate">{page.title}</span>
              <PencilSimple className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>

        {/* Tags */}
        <div>
          <label className="text-xs font-medium text-gray-500 mb-1 flex items-center gap-1">
            <Tag className="text-xs" />
            タグ
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {page.tags.map(tag => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded group"
              >
                {tag}
                <button
                  onClick={() => handleRemoveTag(tag)}
                  className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="text-[10px]" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleAddTag()
              }}
              placeholder="タグを追加..."
              className="flex-1 px-2 py-1 text-xs border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>
        </div>

        {/* Metadata */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-500">メタデータ</label>
          <div className="text-xs text-gray-500 space-y-1">
            <div>作成: {formatDate(page.created_at)}</div>
            <div>更新: {formatDate(page.updated_at)}</div>
          </div>
        </div>

        {/* Version History */}
        <div>
          <button
            onClick={handleToggleVersions}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
          >
            <Clock className="text-sm" />
            バージョン履歴
            <span className="text-[10px] text-gray-400">{showVersions ? '▼' : '▶'}</span>
          </button>
          {showVersions && (
            <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
              {loadingVersions ? (
                <div className="text-xs text-gray-400 py-2">読み込み中...</div>
              ) : versions.length === 0 ? (
                <div className="text-xs text-gray-400 py-2">バージョン履歴はありません</div>
              ) : (
                versions.map(version => (
                  <div
                    key={version.id}
                    className="flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-gray-50 group"
                  >
                    <span className="text-gray-600">{formatDate(version.created_at)}</span>
                    {onRestoreVersion && (
                      <button
                        onClick={() => onRestoreVersion(version)}
                        className="text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] font-medium"
                      >
                        復元
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
