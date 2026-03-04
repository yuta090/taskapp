'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { VideoCamera, Info, ArrowRight } from '@phosphor-icons/react'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import { IntegrationStatusBadge } from '@/components/integrations'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import Link from 'next/link'

type VideoProvider = 'google_meet' | 'zoom' | 'teams'

const PROVIDER_LABELS: Record<VideoProvider, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
}

interface VideoProviderSettingsProps {
  orgId: string
  spaceId: string
}

export function VideoProviderSettings({ orgId, spaceId }: VideoProviderSettingsProps) {
  const { loading, isConnected } = useIntegrations(orgId)

  const [defaultProvider, setDefaultProvider] = useState<VideoProvider | ''>('')
  const [defaultProviderLoading, setDefaultProviderLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const isZoomEnabled = process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true'
  const isTeamsEnabled = process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true'
  const isGoogleCalConnected = isConnected('google_calendar')

  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false
    const fetchDefault = async () => {
      try {
        const { data } = await (supabase as SupabaseClient)
          .from('spaces')
          .select('default_video_provider')
          .eq('id', spaceId)
          .single()

        if (!cancelled && data?.default_video_provider) {
          setDefaultProvider(data.default_video_provider)
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setDefaultProviderLoading(false)
      }
    }
    void fetchDefault()
    return () => { cancelled = true }
  }, [spaceId, supabase])

  const handleDefaultProviderChange = useCallback(
    async (provider: VideoProvider | '') => {
      setDefaultProvider(provider)
      setSaving(true)
      try {
        await (supabase as SupabaseClient)
          .from('spaces')
          .update({ default_video_provider: provider || null })
          .eq('id', spaceId)
      } catch {
        // revert silently
      } finally {
        setSaving(false)
      }
    },
    [supabase, spaceId]
  )

  const availableProviders: { provider: VideoProvider; enabled: boolean; connected: boolean }[] = [
    {
      provider: 'google_meet',
      enabled: true,
      connected: isGoogleCalConnected,
    },
    {
      provider: 'zoom',
      enabled: isZoomEnabled,
      connected: isConnected('zoom'),
    },
    {
      provider: 'teams',
      enabled: isTeamsEnabled,
      connected: isConnected('teams'),
    },
  ]

  const anyProviderAvailable = availableProviders.some((p) => p.enabled)
  const anyConnected = availableProviders.some((p) => p.enabled && p.connected)

  if (!anyProviderAvailable) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <VideoCamera className="text-lg" weight="bold" />
        <h3 className="font-medium">ビデオ会議</h3>
      </div>

      <p className="text-sm text-gray-600">
        日程調整で会議が確定された際に、自動でビデオ会議リンクを生成します。
      </p>

      {/* Default provider selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-600">
          デフォルトプロバイダー
        </label>
        <select
          value={defaultProvider}
          onChange={(e) =>
            handleDefaultProviderChange(e.target.value as VideoProvider | '')
          }
          disabled={defaultProviderLoading || saving}
          className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          data-testid="video-default-provider"
        >
          <option value="">なし</option>
          {availableProviders
            .filter((p) => p.enabled)
            .map((p) => (
              <option key={p.provider} value={p.provider}>
                {PROVIDER_LABELS[p.provider]}
                {!p.connected && p.provider !== 'google_meet' ? ' (未接続)' : ''}
              </option>
            ))}
        </select>
        {saving && <p className="text-xs text-gray-400">保存中...</p>}
      </div>

      {/* Connection status summary */}
      {!loading && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-2">
          <div className="text-xs font-medium text-gray-500 mb-2">接続状況</div>
          {availableProviders
            .filter((p) => p.enabled)
            .map((p) => (
              <div key={p.provider} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{PROVIDER_LABELS[p.provider]}</span>
                <IntegrationStatusBadge
                  status={p.connected ? 'active' : 'disconnected'}
                />
              </div>
            ))}
        </div>
      )}

      {/* Link to account settings if not connected */}
      {!anyConnected && !loading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2">
          <p className="text-sm text-amber-800">
            ビデオ会議アカウントが接続されていません。
          </p>
          <Link
            href="/settings/integrations"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            アカウント設定で接続する
            <ArrowRight className="text-xs" />
          </Link>
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-gray-500">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          ビデオ会議アカウントの接続・解除は
          <Link href="/settings/integrations" className="text-blue-600 hover:underline mx-0.5">
            アカウント設定
          </Link>
          で管理できます。
        </span>
      </div>
    </div>
  )
}
