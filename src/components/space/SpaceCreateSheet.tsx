'use client'

import { useState, useCallback } from 'react'
import {
  X,
  ArrowLeft,
  Globe,
  HardDrives,
  Palette,
  Briefcase,
  Megaphone,
  CalendarDots,
  FileText,
  SpinnerGap,
} from '@phosphor-icons/react'
import { getGenrePresets, getBlankPreset, getPreset } from '@/lib/presets'
import type { PresetGenre, PresetDefinition } from '@/lib/presets'

// Map genre icon names to Phosphor components
const ICON_MAP: Record<string, React.ReactNode> = {
  Globe: <Globe weight="duotone" />,
  Server: <HardDrives weight="duotone" />,
  Palette: <Palette weight="duotone" />,
  Briefcase: <Briefcase weight="duotone" />,
  Megaphone: <Megaphone weight="duotone" />,
  CalendarDays: <CalendarDots weight="duotone" />,
  FileText: <FileText weight="duotone" />,
}

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

  const genrePresets = getGenrePresets()
  const blankPreset = getBlankPreset()

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
            <div>
              <p className="text-sm text-gray-500 mb-4">
                プロジェクトの種類を選んでください。Wikiテンプレートとマイルストーンが自動設定されます。
              </p>

              {/* Genre Cards Grid */}
              <div className="grid grid-cols-3 gap-2.5 mb-4">
                {genrePresets.map((preset) => (
                  <button
                    key={preset.genre}
                    type="button"
                    onClick={() => handleSelectGenre(preset.genre)}
                    className="flex flex-col items-start gap-1.5 p-3 border border-gray-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-left group"
                  >
                    <span className="text-2xl text-indigo-600 group-hover:text-indigo-700">
                      {ICON_MAP[preset.icon] || <FileText weight="duotone" />}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{preset.label}</span>
                    <span className="text-[11px] text-gray-500 leading-tight">{preset.description}</span>
                    <span className="text-[10px] text-gray-400">
                      Wiki {preset.wikiPages.length}件 / MS {preset.milestones.length}件
                    </span>
                  </button>
                ))}
              </div>

              {/* Blank option */}
              <button
                type="button"
                onClick={() => handleSelectGenre('blank')}
                className="w-full py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
              >
                {blankPreset.label} — {blankPreset.description}
              </button>
            </div>
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
              {selectedGenre !== 'blank' && (
                <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-2">
                  <p className="text-xs font-medium text-gray-500">作成されるもの</p>
                  {selectedPreset.wikiPages.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 w-6 shrink-0">Wiki</span>
                      <span className="text-xs text-gray-700">
                        {selectedPreset.wikiPages.map(p => p.title).join(', ')}
                      </span>
                    </div>
                  )}
                  {selectedPreset.milestones.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 w-6 shrink-0">MS</span>
                      <span className="text-xs text-gray-700">
                        {selectedPreset.milestones.map(m => m.name).join(' → ')}
                      </span>
                    </div>
                  )}
                </div>
              )}

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
