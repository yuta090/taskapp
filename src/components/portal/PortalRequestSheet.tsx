'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Bug, Lightbulb, Question, PaperPlaneTilt } from '@phosphor-icons/react'
import { toast } from 'sonner'

type RequestCategory = 'bug' | 'feature' | 'question'

interface PortalRequestSheetProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

const CATEGORIES: { value: RequestCategory; label: string; icon: React.ReactNode; description: string }[] = [
  {
    value: 'bug',
    label: 'バグ報告',
    icon: <Bug weight="duotone" />,
    description: '不具合・表示崩れなど',
  },
  {
    value: 'feature',
    label: '機能要望',
    icon: <Lightbulb weight="duotone" />,
    description: '新機能・改善のリクエスト',
  },
  {
    value: 'question',
    label: '質問・相談',
    icon: <Question weight="duotone" />,
    description: '使い方や仕様について',
  },
]

export function PortalRequestSheet({ isOpen, onClose, onSuccess }: PortalRequestSheetProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<RequestCategory>('feature')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  // Focus title input on open
  useEffect(() => {
    if (isOpen) {
      // Small delay for animation
      const timer = setTimeout(() => titleRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const resetForm = useCallback(() => {
    setTitle('')
    setCategory('feature')
    setDescription('')
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error('タイトルを入力してください')
      titleRef.current?.focus()
      return
    }

    setSubmitting(true)
    try {
      const response = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          category,
          description: description.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const message = (data as { error?: string }).error || 'エラーが発生しました'
        if (response.status === 401) {
          toast.error('セッションが切れました。再ログインしてください。')
        } else {
          toast.error(message)
        }
        return
      }

      toast.success('リクエストを送信しました')
      resetForm()
      onClose()
      onSuccess?.()
    } catch {
      toast.error('ネットワークエラーが発生しました')
    } finally {
      setSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-labelledby="request-sheet-title"
        className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col animate-slide-in-right"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 id="request-sheet-title" className="text-lg font-bold text-gray-900">
            リクエストを送る
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            aria-label="閉じる"
          >
            <X className="text-xl" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              種別
            </label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={`flex flex-col items-center gap-1.5 px-3 py-3 rounded-xl border-2 transition-all text-center ${
                    category === cat.value
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }`}
                >
                  <span className="text-2xl">{cat.icon}</span>
                  <span className="text-xs font-medium">{cat.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">
              {CATEGORIES.find(c => c.value === category)?.description}
            </p>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="request-title" className="block text-sm font-medium text-gray-700 mb-1.5">
              タイトル <span className="text-red-500">*</span>
            </label>
            <input
              ref={titleRef}
              id="request-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder={
                category === 'bug' ? '例: ログイン画面でボタンが反応しない' :
                category === 'feature' ? '例: CSVエクスポート機能がほしい' :
                '例: 納品物の確認フローについて'
              }
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="request-description" className="block text-sm font-medium text-gray-700 mb-1.5">
              詳細（任意）
            </label>
            <textarea
              id="request-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
              rows={5}
              placeholder={
                category === 'bug'
                  ? '再現手順や発生状況を教えてください\n例:\n1. ○○ページを開く\n2. △△ボタンをクリック\n3. エラーが表示される'
                  : '詳しい内容やご要望をお書きください'
              }
              className="w-full px-3 py-2.5 rounded-lg border border-gray-300 text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow resize-none"
            />
            {description.length > 0 && (
              <p className="mt-1 text-xs text-gray-400 text-right">
                {description.length} / 5,000
              </p>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <PaperPlaneTilt className="text-lg" weight="bold" />
            {submitting ? '送信中...' : '送信する'}
          </button>
        </div>
      </div>
    </>
  )
}
