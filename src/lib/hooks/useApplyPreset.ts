'use client'

import { useState, useCallback } from 'react'
import type { PresetGenre } from '@/lib/presets'

interface UseApplyPresetOptions {
  spaceId: string
  onSuccess?: () => void
}

export function useApplyPreset({ spaceId, onSuccess }: UseApplyPresetOptions) {
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const apply = useCallback(
    async (genre: PresetGenre): Promise<boolean> => {
      setIsApplying(true)
      setError(null)

      try {
        const res = await fetch(`/api/spaces/${spaceId}/apply-preset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetGenre: genre }),
        })

        const data = await res.json()

        if (!res.ok) {
          const msg =
            data.error === 'space_not_empty'
              ? 'Wikiページまたはマイルストーンが既に存在します'
              : data.error === 'preset_already_applied'
                ? 'テンプレートは既に適用済みです'
                : data.error === 'insufficient_permissions'
                  ? '権限がありません'
                  : data.error || 'テンプレートの適用に失敗しました'
          setError(msg)
          return false
        }

        onSuccess?.()
        return true
      } catch {
        setError('テンプレートの適用に失敗しました')
        return false
      } finally {
        setIsApplying(false)
      }
    },
    [spaceId, onSuccess],
  )

  return { apply, isApplying, error }
}
