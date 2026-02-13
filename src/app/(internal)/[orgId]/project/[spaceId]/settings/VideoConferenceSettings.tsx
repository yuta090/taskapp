'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { VideoCamera, Trash, Info } from '@phosphor-icons/react'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import type { IntegrationProvider } from '@/lib/integrations/types'
import { IntegrationStatusBadge, SetupGuide } from '@/components/integrations'
import { createClient } from '@/lib/supabase/client'

type VideoProvider = 'google_meet' | 'zoom' | 'teams'

const PROVIDER_LABELS: Record<VideoProvider, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
}

interface VideoConferenceSettingsProps {
  orgId: string
  spaceId: string
}

export function VideoConferenceSettings({ orgId, spaceId }: VideoConferenceSettingsProps) {
  const {
    loading,
    error,
    connections,
    disconnect,
    isConnected,
    getConnection,
  } = useIntegrations(orgId)

  const [defaultProvider, setDefaultProvider] = useState<VideoProvider | ''>('')
  const [defaultProviderLoading, setDefaultProviderLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const isZoomEnabled = process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true'
  const isTeamsEnabled = process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true'
  const isGoogleCalConnected = isConnected('google_calendar')

  // Fetch default provider from space settings
  const supabase = useMemo(() => createClient(), [])

  useEffect(() => {
    let cancelled = false
    const fetchDefault = async () => {
      try {
        const { data } = await (supabase as any)
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
        await (supabase as any)
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

  const handleDisconnect = useCallback(
    async (provider: string) => {
      const conn = getConnection(provider as IntegrationProvider)
      if (!conn) return
      if (!confirm(`${PROVIDER_LABELS[provider as VideoProvider] || provider}連携を解除しますか？`)) return
      await disconnect(conn.id)
    },
    [getConnection, disconnect]
  )

  // Determine available providers
  const availableProviders: { provider: VideoProvider; enabled: boolean; connected: boolean }[] = [
    {
      provider: 'google_meet',
      enabled: true, // always available if Google Calendar is connected
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

  if (!anyProviderAvailable) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <VideoCamera className="text-lg" weight="bold" />
        <h3 className="font-medium">ビデオ会議連携</h3>
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
        {saving && (
          <p className="text-xs text-gray-400">保存中...</p>
        )}
        <p className="text-xs text-gray-500">
          日程調整の作成時に自動で選択されるビデオ会議プロバイダーです。
        </p>
      </div>

      {/* Provider status cards */}
      {loading ? (
        <div className="p-4 text-sm text-gray-500">読み込み中...</div>
      ) : error ? (
        <div className="p-4 text-sm text-red-600 bg-red-50 rounded-lg">
          {error.message}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Google Meet */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Google Meet</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Google Calendar連携から自動で利用可能
                </p>
              </div>
              <IntegrationStatusBadge
                status={isGoogleCalConnected ? 'active' : 'disconnected'}
              />
            </div>
            <SetupGuide defaultOpen={!isGoogleCalConnected}>
              <p>
                Google Meet は Google Calendar 連携を通じて利用できます。
                別途の接続手続きは不要です。
              </p>
              {!isGoogleCalConnected && (
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                  <span>
                    上の「Google Calendar 連携」セクションでGoogleアカウントを接続すると、
                    自動的にGoogle Meetが利用可能になります。
                  </span>
                </div>
              )}
              <div className="flex items-start gap-2 text-gray-500">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>日程調整で会議が確定されると、自動でGoogle Meetリンクが生成されます。</span>
              </div>
            </SetupGuide>
          </div>

          {/* Zoom */}
          {isZoomEnabled && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Zoom</p>
                </div>
                <div className="flex items-center gap-2">
                  <IntegrationStatusBadge
                    status={isConnected('zoom') ? 'active' : 'disconnected'}
                  />
                  {isConnected('zoom') && (
                    <button
                      onClick={() => handleDisconnect('zoom')}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="連携を解除"
                      data-testid="zoom-disconnect"
                    >
                      <Trash className="text-sm" />
                    </button>
                  )}
                </div>
              </div>

              <SetupGuide defaultOpen={!isConnected('zoom')}>
                <p>
                  Zoom と連携すると、日程調整で会議が確定された際に自動でZoomミーティングリンクが生成されます。
                </p>
                <p className="font-medium text-gray-700">手順:</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>下の「Zoomアカウントを接続」をクリック</li>
                  <li>Zoomアカウントでログイン</li>
                  <li>「ミーティングの管理」権限を許可</li>
                  <li>自動的にこの画面に戻ります</li>
                </ol>
                <div className="flex items-start gap-2 text-gray-500">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>接続後、日程調整の作成時にZoomを選択できます。</span>
                </div>
                <div className="flex items-start gap-2 text-gray-500">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>接続はいつでも解除できます。</span>
                </div>
              </SetupGuide>

              {!isConnected('zoom') && (
                <button
                  onClick={() => {
                    window.location.href = `/api/integrations/auth/zoom?orgId=${orgId}&spaceId=${spaceId}`
                  }}
                  className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  data-testid="zoom-connect"
                >
                  <VideoCamera weight="bold" />
                  Zoomアカウントを接続
                </button>
              )}
            </div>
          )}

          {/* Teams */}
          {isTeamsEnabled && (
            <div className="border border-gray-200 rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-700">Microsoft Teams</p>
                </div>
                <div className="flex items-center gap-2">
                  <IntegrationStatusBadge
                    status={isConnected('teams') ? 'active' : 'disconnected'}
                  />
                  {isConnected('teams') && (
                    <button
                      onClick={() => handleDisconnect('teams')}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="連携を解除"
                      data-testid="teams-disconnect"
                    >
                      <Trash className="text-sm" />
                    </button>
                  )}
                </div>
              </div>

              <SetupGuide defaultOpen={!isConnected('teams')}>
                <p>
                  Microsoft Teams と連携すると、日程調整で会議が確定された際に自動でTeamsミーティングリンクが生成されます。
                </p>
                <p className="font-medium text-gray-700">手順:</p>
                <ol className="list-decimal list-inside space-y-1 text-gray-600">
                  <li>下の「Teamsアカウントを接続」をクリック</li>
                  <li>Microsoftアカウントでログイン</li>
                  <li>「オンライン会議の管理」権限を許可</li>
                  <li>自動的にこの画面に戻ります</li>
                </ol>
                <div className="flex items-start gap-2 text-gray-500">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>組織のMicrosoft 365アカウントが必要です。</span>
                </div>
                <div className="flex items-start gap-2 text-gray-500">
                  <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>接続はいつでも解除できます。</span>
                </div>
              </SetupGuide>

              {!isConnected('teams') && (
                <button
                  onClick={() => {
                    window.location.href = `/api/integrations/auth/teams?orgId=${orgId}&spaceId=${spaceId}`
                  }}
                  className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  data-testid="teams-connect"
                >
                  <VideoCamera weight="bold" />
                  Teamsアカウントを接続
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Info note */}
      <div className="flex items-start gap-2 text-xs text-gray-500">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          日程調整で会議を確定する際に、選択されたプロバイダーでビデオ会議リンクが自動生成されます。
        </span>
      </div>
    </div>
  )
}
