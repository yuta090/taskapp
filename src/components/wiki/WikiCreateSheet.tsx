'use client'

import { useState } from 'react'
import { X } from '@phosphor-icons/react'

interface WikiCreateSheetProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: { title: string; tags?: string[] }) => Promise<void>
}

export function WikiCreateSheet({ isOpen, onClose, onSubmit }: WikiCreateSheetProps) {
  const [title, setTitle] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  if (!isOpen) return null

  const handleAddTag = () => {
    const tag = tagInput.trim()
    if (tag && !tags.includes(tag)) {
      setTags(prev => [...prev, tag])
    }
    setTagInput('')
  }

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(prev => prev.filter(t => t !== tagToRemove))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || isSubmitting) return
    setIsSubmitting(true)
    try {
      await onSubmit({ title: title.trim(), tags: tags.length > 0 ? tags : undefined })
      setTitle('')
      setTags([])
      setTagInput('')
      onClose()
    } catch {
      // Error handled by parent
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-in slide-in-from-bottom duration-200">
        <div className="max-w-2xl mx-auto px-6 py-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">新しいWikiページ</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="text-lg" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="ページタイトル"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                autoFocus
              />
            </div>

            {/* Tags */}
            <div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                  >
                    {tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)} className="text-gray-400 hover:text-red-500">
                      <X className="text-[10px]" />
                    </button>
                  </span>
                ))}
              </div>
              <input
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddTag()
                  }
                }}
                placeholder="タグを追加 (Enter)"
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500/20"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                キャンセル
              </button>
              <button
                type="submit"
                disabled={!title.trim() || isSubmitting}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? '作成中...' : '作成'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  )
}
