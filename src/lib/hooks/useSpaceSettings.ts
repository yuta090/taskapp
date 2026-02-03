'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

interface SpaceSettings {
  ownerFieldEnabled: boolean | null // null = 組織設定に従う
}

interface UseSpaceSettingsResult {
  settings: SpaceSettings | null
  shouldShowOwnerField: boolean
  loading: boolean
  error: string | null
  updateOwnerFieldEnabled: (enabled: boolean | null) => Promise<void>
  refetch: () => Promise<void>
}

export function useSpaceSettings(spaceId: string | null): UseSpaceSettingsResult {
  const [settings, setSettings] = useState<SpaceSettings | null>(null)
  const [shouldShowOwnerField, setShouldShowOwnerField] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Race condition対策: リクエストIDで最新のリクエストのみ状態更新
  const requestIdRef = useRef(0)
  // 現在のspaceIdを追跡（updateOwnerFieldEnabled用）
  const currentSpaceIdRef = useRef(spaceId)
  currentSpaceIdRef.current = spaceId

  const supabase = useMemo(() => createClient(), [])

  const fetchSettings = useCallback(async () => {
    // spaceIdが変わった/nullになった場合もリクエストIDをインクリメント
    const currentRequestId = ++requestIdRef.current

    if (!spaceId) {
      setSettings(null)
      setShouldShowOwnerField(false)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // スペース設定を取得
      const { data: spaceData, error: spaceError } = await (supabase as any)
        .from('spaces')
        .select('owner_field_enabled')
        .eq('id', spaceId)
        .single()

      if (spaceError) throw spaceError

      // 古いリクエストは無視
      if (currentRequestId !== requestIdRef.current) return

      setSettings({
        ownerFieldEnabled: spaceData?.owner_field_enabled ?? null,
      })

      // 表示判定をRPCで取得
      const { data: showData, error: showError } = await (supabase as any)
        .rpc('rpc_should_show_owner_field', { p_space_id: spaceId })

      if (showError) throw showError

      // 古いリクエストは無視
      if (currentRequestId !== requestIdRef.current) return

      setShouldShowOwnerField(showData ?? false)
    } catch (err) {
      // 古いリクエストのエラーは無視
      if (currentRequestId !== requestIdRef.current) return

      console.error('Failed to fetch space settings:', err)
      setError('設定の取得に失敗しました')
    } finally {
      // 古いリクエストのloading解除は無視
      if (currentRequestId === requestIdRef.current) {
        setLoading(false)
      }
    }
  }, [spaceId, supabase])

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  const updateOwnerFieldEnabled = useCallback(
    async (enabled: boolean | null) => {
      if (!spaceId) return

      // 更新対象のspaceIdをキャプチャ
      const targetSpaceId = spaceId

      try {
        const { error: updateError } = await (supabase as any)
          .from('spaces')
          .update({ owner_field_enabled: enabled })
          .eq('id', targetSpaceId)

        if (updateError) throw updateError

        // ナビゲーション後は再取得しない（異なるspaceの状態を上書きしないため）
        if (currentSpaceIdRef.current !== targetSpaceId) return

        // 再取得
        await fetchSettings()
      } catch (err) {
        console.error('Failed to update space settings:', err)
        throw new Error('設定の更新に失敗しました')
      }
    },
    [spaceId, supabase, fetchSettings]
  )

  return {
    settings,
    shouldShowOwnerField,
    loading,
    error,
    updateOwnerFieldEnabled,
    refetch: fetchSettings,
  }
}
