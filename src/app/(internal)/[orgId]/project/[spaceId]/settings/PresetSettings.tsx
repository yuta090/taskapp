'use client'

import { useState, useEffect, useRef } from 'react'
import { Sparkle } from '@phosphor-icons/react'
import { createClient } from '@/lib/supabase/client'
import { PresetApplicator } from '@/components/space/PresetApplicator'
import { getPreset, isValidPresetGenre } from '@/lib/presets'
import type { PresetGenre } from '@/lib/presets'

interface PresetSettingsProps {
  orgId: string
  spaceId: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function PresetSettings({ orgId, spaceId }: PresetSettingsProps) {
  const [presetGenre, setPresetGenre] = useState<string | null>(null)
  const [wikiCount, setWikiCount] = useState<number | null>(null)
  const [msCount, setMsCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [showPicker, setShowPicker] = useState(false)

  const supabaseRef = useRef(createClient())

  useEffect(() => {
    const load = async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabaseRef.current as any

      const [spaceRes, wikiRes, msRes] = await Promise.all([
        sb.from('spaces').select('*').eq('id', spaceId).single(),
        sb.from('wiki_pages').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
        sb.from('milestones').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
      ])

      setPresetGenre(spaceRes.data?.preset_genre ?? null)
      setWikiCount(wikiRes.count ?? 0)
      setMsCount(msRes.count ?? 0)
      setLoading(false)
    }
    void load()
  }, [spaceId])

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
    // Re-fetch counts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabaseRef.current as any
    Promise.all([
      sb.from('spaces').select('*').eq('id', spaceId).single(),
      sb.from('wiki_pages').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
      sb.from('milestones').select('id', { count: 'exact', head: true }).eq('space_id', spaceId),
    ]).then(([spaceRes, wikiRes, msRes]: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      any, any, any,
    ]) => {
      setPresetGenre(spaceRes.data?.preset_genre ?? null)
      setWikiCount(wikiRes.count ?? 0)
      setMsCount(msRes.count ?? 0)
    })
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-gray-700 mb-4">
        <Sparkle className="text-lg" />
        <h3 className="font-medium">初期構成</h3>
      </div>

      {appliedPreset ? (
        <div className="text-sm text-gray-600">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded text-sm">
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
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm text-indigo-600 border border-indigo-200 hover:bg-indigo-50 rounded-lg transition-colors"
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
