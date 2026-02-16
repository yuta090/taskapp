'use client'

import { useState } from 'react'
import { ArrowLeft, FileText, SpinnerGap } from '@phosphor-icons/react'
import { GenrePicker, GenrePreview, ICON_MAP } from './GenrePicker'
import { getPreset } from '@/lib/presets'
import type { PresetGenre } from '@/lib/presets'
import { useApplyPreset } from '@/lib/hooks/useApplyPreset'

interface PresetApplicatorProps {
  spaceId: string
  onApplied?: () => void
}

export function PresetApplicator({ spaceId, onApplied }: PresetApplicatorProps) {
  const [selectedGenre, setSelectedGenre] = useState<PresetGenre | null>(null)
  const { apply, isApplying, error } = useApplyPreset({
    spaceId,
    onSuccess: onApplied,
  })

  const selectedPreset = selectedGenre ? getPreset(selectedGenre) : null

  const handleConfirm = async () => {
    if (!selectedGenre) return
    const success = await apply(selectedGenre)
    if (success) setSelectedGenre(null)
  }

  // Step 1: Genre selection
  if (!selectedGenre) {
    return (
      <GenrePicker
        onSelect={setSelectedGenre}
        description="テンプレートを選んでWikiとマイルストーンを一括セットアップ"
      />
    )
  }

  // Step 2: Confirmation + apply
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedGenre(null)}
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft className="text-lg" />
        </button>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded text-sm">
          <span className="text-base">
            {selectedPreset && (ICON_MAP[selectedPreset.icon] || <FileText weight="duotone" />)}
          </span>
          {selectedPreset?.label}
        </span>
      </div>

      {selectedPreset && <GenrePreview preset={selectedPreset} />}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setSelectedGenre(null)}
          className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isApplying}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {isApplying ? (
            <>
              <SpinnerGap className="text-base animate-spin" />
              適用中...
            </>
          ) : (
            'テンプレートを適用'
          )}
        </button>
      </div>
    </div>
  )
}
