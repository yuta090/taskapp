'use client'

import { useState, useCallback } from 'react'
import {
  X,
  ArrowLeft,
  FileText,
  SpinnerGap,
} from '@phosphor-icons/react'
import { getPreset } from '@/lib/presets'
import type { PresetGenre, PresetDefinition } from '@/lib/presets'
import { GenrePicker, GenrePreview, ICON_MAP } from './GenrePicker'

interface SpaceCreateSheetProps {
  isOpen: boolean
  onClose: () => void
  orgId: string
  onCreated: (spaceId: string) => void
}

export function SpaceCreateSheet({ isOpen, onClose, orgId, onCreated }: SpaceCreateSheetProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [selectedGenre, setSelectedGenre] = useState<PresetGenre | null>(null)
  const [name, setName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSelectGenre = useCallback((genre: PresetGenre) => {
    setSelectedGenre(genre)
    setStep(2)
    setError(null)
  }, [])

  const handleBack = useCallback(() => {
    setStep(1)
    setError(null)
  }, [])

  const handleClose = useCallback(() => {
    setStep(1)
    setSelectedGenre(null)
    setName('')
    setError(null)
    setIsSubmitting(false)
    onClose()
  }, [onClose])

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !selectedGenre || isSubmitting) return

    setIsSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/spaces/create-with-preset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          presetGenre: selectedGenre,
          orgId,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'プロジェクトの作成に失敗しました')
        return
      }

      // Reset and notify parent
      handleClose()
      onCreated(data.space.id)
    } catch {
      setError('プロジェクトの作成に失敗しました')
    } finally {
      setIsSubmitting(false)
    }
  }, [name, selectedGenre, orgId, isSubmitting, handleClose, onCreated])

  if (!isOpen) return null

  const selectedPreset: PresetDefinition | null = selectedGenre ? getPreset(selectedGenre) : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/20 z-40" onClick={handleClose} />

      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 bg-white rounded-t-2xl shadow-2xl z-50 animate-in slide-in-from-bottom duration-200">
        <div className="max-w-2xl mx-auto px-6 py-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              {step === 2 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                >
                  <ArrowLeft className="text-lg" />
                </button>
              )}
              <h2 className="text-lg font-semibold text-gray-900">
                新しいプロジェクトを作成
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="text-lg" />
            </button>
          </div>

          {/* Step 1: Genre Selection */}
          {step === 1 && (
            <GenrePicker
              onSelect={handleSelectGenre}
              includeBlankInGrid
              description="プロジェクトの種類を選んでください。Wikiテンプレートとマイルストーンが自動設定されます。"
            />
          )}

          {/* Step 2: Name + Preview + Confirm */}
          {step === 2 && selectedPreset && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Selected genre badge */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded text-sm">
                  <span className="text-base">
                    {ICON_MAP[selectedPreset.icon] || <FileText weight="duotone" />}
                  </span>
                  {selectedPreset.label}
                </span>
                <button
                  type="button"
                  onClick={handleBack}
                  className="text-xs text-gray-500 hover:text-indigo-600 transition-colors"
                >
                  変更
                </button>
              </div>

              {/* Project name input */}
              <div>
                <label htmlFor="space-name" className="block text-sm font-medium text-gray-700 mb-1">
                  プロジェクト名
                </label>
                <input
                  id="space-name"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例: Webサイトリニューアル"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  autoFocus
                />
              </div>

              {/* Preview */}
              <GenrePreview preset={selectedPreset} />

              {/* Error */}
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={!name.trim() || isSubmitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {isSubmitting ? (
                    <>
                      <SpinnerGap className="text-base animate-spin" />
                      作成中...
                    </>
                  ) : (
                    '作成'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  )
}
