'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, Bug, Lightbulb, Question, PaperPlaneTilt } from '@phosphor-icons/react'
import { toast } from 'sonner'

type RequestCategory = 'bug' | 'feature' | 'question'
type BugFrequency = 'every_time' | 'sometimes' | 'once'

interface BugDetails {
  screen: string
  steps: string
  actual: string
  expected: string
  frequency: BugFrequency
}

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

const FREQUENCY_OPTIONS: { value: BugFrequency; label: string }[] = [
  { value: 'every_time', label: '毎回' },
  { value: 'sometimes', label: 'ときどき' },
  { value: 'once', label: '1回だけ' },
]

const INITIAL_BUG_DETAILS: BugDetails = {
  screen: '',
  steps: '',
  actual: '',
  expected: '',
  frequency: 'every_time',
}

export function PortalRequestSheet({ isOpen, onClose, onSuccess }: PortalRequestSheetProps) {
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<RequestCategory>('feature')
  const [description, setDescription] = useState('')
  const [bugDetails, setBugDetails] = useState<BugDetails>(INITIAL_BUG_DETAILS)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const titleRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)

  const isBug = category === 'bug'

  const clearFieldError = useCallback((field: string) => {
    setFieldErrors(prev => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  // Focus title input on open
  useEffect(() => {
    if (isOpen) {
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
    setBugDetails(INITIAL_BUG_DETAILS)
    setFieldErrors({})
  }, [])

  const updateBugField = useCallback(<K extends keyof BugDetails>(key: K, value: BugDetails[K]) => {
    setBugDetails(prev => ({ ...prev, [key]: value }))
  }, [])

  const validate = (): boolean => {
    const errors: Record<string, string> = {}

    if (!title.trim()) {
      errors.title = 'タイトルを入力してください'
    }

    if (isBug) {
      if (!bugDetails.screen.trim()) errors.screen = '発生した画面を入力してください'
      if (!bugDetails.steps.trim()) errors.steps = '再現手順を入力してください'
      if (!bugDetails.actual.trim()) errors.actual = '実際に起きたことを入力してください'
      if (!bugDetails.expected.trim()) errors.expected = '期待する動作を入力してください'
    } else if (!description.trim()) {
      errors.description = category === 'feature' ? '機能の内容を入力してください' : '質問内容を入力してください'
    }

    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) {
      // Focus first errored field
      if (errors.title) titleRef.current?.focus()
      return false
    }
    return true
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!validate()) return

    const trimmedTitle = title.trim()

    setSubmitting(true)
    try {
      const response = await fetch('/api/portal/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmedTitle,
          category,
          description: description.trim() || undefined,
          ...(isBug ? {
            bugDetails: {
              screen: bugDetails.screen.trim(),
              steps: bugDetails.steps.trim(),
              actual: bugDetails.actual.trim(),
              expected: bugDetails.expected.trim(),
              frequency: bugDetails.frequency,
            },
          } : {}),
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

  const canSubmit = title.trim().length > 0 && (
    isBug ? (
      bugDetails.screen.trim().length > 0 &&
      bugDetails.steps.trim().length > 0 &&
      bugDetails.actual.trim().length > 0 &&
      bugDetails.expected.trim().length > 0
    ) : description.trim().length > 0
  )

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
              onChange={(e) => { setTitle(e.target.value); clearFieldError('title') }}
              maxLength={200}
              placeholder={
                isBug ? '例: ログイン画面でボタンが反応しない' :
                category === 'feature' ? '例: CSVエクスポート機能がほしい' :
                '例: 納品物の確認フローについて'
              }
              className={`w-full px-3 py-2.5 rounded-lg border text-sm text-gray-900 placeholder-gray-400 focus:ring-2 transition-shadow ${
                fieldErrors.title
                  ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500'
                  : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
              }`}
            />
            {fieldErrors.title && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.title}</p>
            )}
          </div>

          {/* Bug-specific fields */}
          {isBug && (
            <div className="space-y-4 p-4 bg-red-50/50 rounded-xl border border-red-100">
              <p className="text-xs font-medium text-red-700">
                バグの詳細（すべて必須）
              </p>

              {/* Screen */}
              <div>
                <label htmlFor="bug-screen" className="block text-xs font-medium text-gray-700 mb-1">
                  どの画面で起きましたか？ <span className="text-red-500">*</span>
                </label>
                <input
                  id="bug-screen"
                  type="text"
                  value={bugDetails.screen}
                  onChange={(e) => { updateBugField('screen', e.target.value); clearFieldError('screen') }}
                  maxLength={200}
                  placeholder="例: タスク一覧 / ダッシュボード / 設定画面"
                  className={`w-full px-3 py-2 rounded-lg border text-sm text-gray-900 placeholder-gray-400 focus:ring-2 transition-shadow ${
                    fieldErrors.screen ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
                {fieldErrors.screen && <p className="mt-1 text-xs text-red-600">{fieldErrors.screen}</p>}
              </div>

              {/* Steps */}
              <div>
                <label htmlFor="bug-steps" className="block text-xs font-medium text-gray-700 mb-1">
                  何をしたら起きましたか？（手順） <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="bug-steps"
                  value={bugDetails.steps}
                  onChange={(e) => { updateBugField('steps', e.target.value); clearFieldError('steps') }}
                  maxLength={2000}
                  rows={3}
                  placeholder={'1. ○○ページを開く\n2. △△ボタンをクリック\n3. エラーが表示される'}
                  className={`w-full px-3 py-2 rounded-lg border text-sm text-gray-900 placeholder-gray-400 focus:ring-2 transition-shadow resize-none ${
                    fieldErrors.steps ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
                {fieldErrors.steps && <p className="mt-1 text-xs text-red-600">{fieldErrors.steps}</p>}
              </div>

              {/* Actual */}
              <div>
                <label htmlFor="bug-actual" className="block text-xs font-medium text-gray-700 mb-1">
                  実際に起きたこと <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="bug-actual"
                  value={bugDetails.actual}
                  onChange={(e) => { updateBugField('actual', e.target.value); clearFieldError('actual') }}
                  maxLength={2000}
                  rows={2}
                  placeholder="例: 保存ボタンを押した後、画面が真っ白になった"
                  className={`w-full px-3 py-2 rounded-lg border text-sm text-gray-900 placeholder-gray-400 focus:ring-2 transition-shadow resize-none ${
                    fieldErrors.actual ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
                {fieldErrors.actual && <p className="mt-1 text-xs text-red-600">{fieldErrors.actual}</p>}
              </div>

              {/* Expected */}
              <div>
                <label htmlFor="bug-expected" className="block text-xs font-medium text-gray-700 mb-1">
                  本来どうなる想定でしたか？ <span className="text-red-500">*</span>
                </label>
                <textarea
                  id="bug-expected"
                  value={bugDetails.expected}
                  onChange={(e) => { updateBugField('expected', e.target.value); clearFieldError('expected') }}
                  maxLength={2000}
                  rows={2}
                  placeholder="例: 保存完了のメッセージが出て、内容が更新される"
                  className={`w-full px-3 py-2 rounded-lg border text-sm text-gray-900 placeholder-gray-400 focus:ring-2 transition-shadow resize-none ${
                    fieldErrors.expected ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
                  }`}
                />
                {fieldErrors.expected && <p className="mt-1 text-xs text-red-600">{fieldErrors.expected}</p>}
              </div>

              {/* Frequency */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-2">
                  どのくらいの頻度で起きますか？ <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {FREQUENCY_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateBugField('frequency', opt.value)}
                      className={`flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${
                        bugDetails.frequency === opt.value
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Description (for feature/question, or optional note for bug) */}
          <div>
            <label htmlFor="request-description" className="block text-sm font-medium text-gray-700 mb-1.5">
              {isBug ? '補足メモ（任意）' : category === 'feature' ? 'ほしい機能の内容' : '質問内容'}
              {!isBug && <span className="text-red-500 ml-0.5">*</span>}
            </label>
            <textarea
              id="request-description"
              value={description}
              onChange={(e) => { setDescription(e.target.value); clearFieldError('description') }}
              maxLength={5000}
              rows={isBug ? 3 : 5}
              placeholder={
                isBug
                  ? 'その他、気づいたことがあればご記入ください'
                  : category === 'feature'
                    ? '例: 月次報告用にタスク一覧をCSVでダウンロードしたい'
                    : '例: クライアント側で担当者を追加できますか？'
              }
              className={`w-full px-3 py-2.5 rounded-lg border text-sm text-gray-900 placeholder-gray-400 focus:ring-2 transition-shadow resize-none ${
                fieldErrors.description
                  ? 'border-red-400 focus:ring-red-500/20 focus:border-red-500'
                  : 'border-gray-300 focus:ring-indigo-500 focus:border-indigo-500'
              }`}
            />
            {fieldErrors.description && (
              <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
            )}
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
            disabled={submitting || !canSubmit}
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
