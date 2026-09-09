'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Sparkle } from '@phosphor-icons/react'
import { useSpaceRow, spaceQueryKey } from '@/lib/hooks/useSpaceRow'
import { useSpaceContentCounts } from '@/lib/hooks/useSpaceContentCounts'
import { PresetApplicator } from '@/components/space/PresetApplicator'
import { getPreset, isValidPresetGenre } from '@/lib/presets'
import type { PresetGenre } from '@/lib/presets'

interface PresetSettingsProps {
  orgId: string
  spaceId: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PresetSettings({ orgId, spaceId }: PresetSettingsProps) {
  // 初期構成(preset_genre)はプロジェクト1行の共有キャッシュから読む
  const { space, isPending: spacePending } = useSpaceRow(spaceId)
  const presetGenre = (space?.preset_genre as string | null) ?? null
  const queryClient = useQueryClient()

  const [showPicker, setShowPicker] = useState(false)

  // 「まだ空か」の判定に使う件数。「はじめての設定」バナーと同じキャッシュを見る
  const { counts, isPending: countsPending } = useSpaceContentCounts(spaceId)
  const wikiCount = counts?.wikiPages ?? null
  const msCount = counts?.milestones ?? null
  const loading = countsPending || spacePending

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-2 text-gray-700 mb-4">
          <Sparkle className="text-lg" />
          <h3 className="font-medium">初期構成</h3>
        </div>
        <div className="text-sm text-gray-400">読み込み中...</div>
      </div>
    )
  }

  const isEmpty = wikiCount === 0 && msCount === 0
  const hasPreset = presetGenre && presetGenre !== 'blank' && isValidPresetGenre(presetGenre)
  const appliedPreset = hasPreset ? getPreset(presetGenre as PresetGenre) : null

  const handleApplied = () => {
    setShowPicker(false)
    // 初期構成は共有キャッシュ側を取り直す（同じ行を見ている他の画面も一緒に揃う）
    void queryClient.invalidateQueries({ queryKey: spaceQueryKey(spaceId) })
    void queryClient.invalidateQueries({ queryKey: ['spaceContentCounts', spaceId] })
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-gray-700 mb-4">
        <Sparkle className="text-lg" />
        <h3 className="font-medium">初期構成</h3>
      </div>

      {appliedPreset ? (
        <div className="text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-ink rounded text-sm">
            {appliedPreset.label}
          </span>
          <span className="ml-2 text-gray-400">適用済み</span>
        </div>
      ) : isEmpty ? (
        showPicker ? (
          <PresetApplicator spaceId={spaceId} onApplied={handleApplied} />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">
              テンプレートを適用して、Wikiページとマイルストーンを一括セットアップできます。
            </p>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-indigo-ink border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors"
            >
              テンプレートを適用
            </button>
          </div>
        )
      ) : (
        <p className="text-sm text-gray-400">
          Wikiページまたはマイルストーンが既に存在するため、テンプレートは適用できません。
        </p>
      )}
    </div>
  )
}
