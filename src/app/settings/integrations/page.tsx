'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, CalendarCheck, VideoCamera, Trash, Info, CircleNotch, PlugsConnected } from '@phosphor-icons/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useCurrentOrg } from '@/lib/hooks/useCurrentOrg'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar/config'
import { IntegrationStatusBadge, SetupGuide } from '@/components/integrations'
import type { IntegrationProvider } from '@/lib/integrations/types'

type VideoProvider = 'google_meet' | 'zoom' | 'teams'

const VIDEO_LABELS: Record<VideoProvider, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  teams: 'Microsoft Teams',
}

export default function UserIntegrationsPage() {
  const searchParams = useSearchParams()
  const { orgId, loading: orgLoading } = useCurrentOrg()
  const {
    loading,
    error,
    connectGoogle,
    disconnect,
    getConnection,
    isConnected,
  } = useIntegrations(orgId ?? '')

  // OAuthコールバック後のトースト表示
  useEffect(() => {
    const integration = searchParams.get('integration')
    const status = searchParams.get('status')
    if (!integration || !status) return

    const labels: Record<string, string> = {
      google_calendar: 'Google Calendar',
      zoom: 'Zoom',
      teams: 'Microsoft Teams',
    }
    const label = labels[integration] || integration

    if (status === 'connected') {
      toast.success(`${label}を接続しました`)
    } else if (status === 'cancelled') {
      toast.info(`${label}の接続がキャンセルされました`)
    } else if (status === 'error') {
      const message = searchParams.get('message')
      toast.error(`${label}の接続に失敗しました${message ? `: ${message}` : ''}`)
    }

    // クエリパラメータをクリーンアップ（URLを綺麗に保つ）
    window.history.replaceState({}, '', '/settings/integrations')
  }, [searchParams])

  const isGCalEnabled = isGoogleCalendarConfigured()
  const isZoomEnabled = process.env.NEXT_PUBLIC_ZOOM_ENABLED === 'true'
  const isTeamsEnabled = process.env.NEXT_PUBLIC_TEAMS_ENABLED === 'true'
  const isGCalConnected = isConnected('google_calendar')

  const handleDisconnect = async (provider: string) => {
    const conn = getConnection(provider as IntegrationProvider)
    if (!conn) return
    if (!confirm(`${provider === 'google_calendar' ? 'Google Calendar' : VIDEO_LABELS[provider as VideoProvider] || provider}連携を解除しますか？`)) return
    await disconnect(conn.id)
  }

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return d.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (orgLoading || !orgId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link
              href="/inbox"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">外部連携</h1>
              <p className="text-sm text-gray-500">個人の外部サービス接続</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Google Calendar */}
        {isGCalEnabled && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-gray-700">
              <CalendarCheck className="text-lg" weight="bold" />
              <h3 className="font-medium">Google Calendar</h3>
            </div>

            {loading ? (
              <div className="p-4 text-sm text-gray-500">読み込み中...</div>
            ) : error ? (
              <div className="p-4 text-sm text-red-700 bg-red-50 rounded-lg">
                {error.message}
              </div>
            ) : isGCalConnected ? (
              <div className="space-y-3">
                <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600">ステータス:</span>
                      <IntegrationStatusBadge status="active" />
                    </div>
                    <button
                      onClick={() => handleDisconnect('google_calendar')}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="連携を解除"
                    >
                      <Trash className="text-sm" />
                    </button>
                  </div>

                  {(() => {
                    const googleConnection = getConnection('google_calendar')
                    const meta = googleConnection?.metadata as Record<string, unknown> | null
                    const email = meta?.email
                    return (
                      <>
                        {email && (
                          <div className="text-sm">
                            <span className="text-gray-500">アカウント: </span>
                            <span className="text-gray-700">{String(email)}</span>
                          </div>
                        )}
                        <div className="text-sm">
                          <span className="text-gray-500">スコープ: </span>
                          <span className="text-gray-700">
                            {googleConnection?.scopes || 'calendar.freebusy'}
                          </span>
                        </div>
                        <div className="text-sm">
                          <span className="text-gray-500">最終同期: </span>
                          <span className="text-gray-700">
                            {formatDate(googleConnection?.last_refreshed_at || googleConnection?.updated_at || null)}
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>

                <SetupGuide defaultOpen={false}>
                  <p>
                    Google Calendar と連携すると、日程調整の候補日に参加者の予定を自動で確認できます。
                  </p>
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                    <span>取得するのは空き/埋まり情報のみです。予定の詳細は読み取りません。</span>
                  </div>
                </SetupGuide>
              </div>
            ) : (
              <div className="space-y-3">
                <SetupGuide defaultOpen={true}>
                  <p>
                    Google Calendar と連携すると、日程調整の候補日に参加者の予定を自動で確認できます。
                  </p>
                  <div className="flex items-start gap-2">
                    <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                    <span>取得するのは空き/埋まり情報のみです。予定の詳細は読み取りません。</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-gray-600">
                    <li>下の「Googleアカウントを接続」をクリック</li>
                    <li>Googleアカウントでログイン</li>
                    <li>「カレンダーの空き情報の参照」を許可</li>
                    <li>自動的にこの画面に戻ります</li>
                  </ol>
                </SetupGuide>

                <button
                  onClick={connectGoogle}
                  className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                >
                  <CalendarCheck weight="bold" />
                  Googleアカウントを接続
                </button>
              </div>
            )}
          </div>
        )}

        {/* Video Conference Accounts */}
        {(isZoomEnabled || isTeamsEnabled || isGCalEnabled) && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            <div className="flex items-center gap-2 text-gray-700">
              <VideoCamera className="text-lg" weight="bold" />
              <h3 className="font-medium">ビデオ会議アカウント</h3>
            </div>

            <p className="text-sm text-gray-600">
              接続したアカウントは、日程調整で会議が確定された際にビデオ会議リンクの自動生成に使用されます。
            </p>

            {loading ? (
              <div className="p-4 text-sm text-gray-500">読み込み中...</div>
            ) : error ? (
              <div className="p-4 text-sm text-red-700 bg-red-50 rounded-lg">
                {error.message}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Google Meet */}
                {isGCalEnabled && (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-700">Google Meet</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          Google Calendar連携から自動で利用可能
                        </p>
                      </div>
                      <IntegrationStatusBadge
                        status={isGCalConnected ? 'active' : 'disconnected'}
                      />
                    </div>
                    {!isGCalConnected && (
                      <p className="text-xs text-gray-500 mt-2">
                        上の Google Calendar を接続すると自動的に利用可能になります。
                      </p>
                    )}
                  </div>
                )}

                {/* Zoom */}
                {isZoomEnabled && (
                  <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-700">Zoom</p>
                      <div className="flex items-center gap-2">
                        <IntegrationStatusBadge
                          status={isConnected('zoom') ? 'active' : 'disconnected'}
                        />
                        {isConnected('zoom') && (
                          <button
                            onClick={() => handleDisconnect('zoom')}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="連携を解除"
                          >
                            <Trash className="text-sm" />
                          </button>
                        )}
                      </div>
                    </div>
                    {!isConnected('zoom') && (
                      <button
                        onClick={() => {
                          window.location.href = `/api/integrations/auth/zoom?orgId=${orgId}`
                        }}
                        className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
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
                      <p className="text-sm font-medium text-gray-700">Microsoft Teams</p>
                      <div className="flex items-center gap-2">
                        <IntegrationStatusBadge
                          status={isConnected('teams') ? 'active' : 'disconnected'}
                        />
                        {isConnected('teams') && (
                          <button
                            onClick={() => handleDisconnect('teams')}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                            title="連携を解除"
                          >
                            <Trash className="text-sm" />
                          </button>
                        )}
                      </div>
                    </div>
                    {!isConnected('teams') && (
                      <button
                        onClick={() => {
                          window.location.href = `/api/integrations/auth/teams?orgId=${orgId}`
                        }}
                        className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                      >
                        <VideoCamera weight="bold" />
                        Teamsアカウントを接続
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-start gap-2 text-xs text-gray-500">
              <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                プロジェクト設定でデフォルトのビデオ会議プロバイダーを選択できます。
              </span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isGCalEnabled && !isZoomEnabled && !isTeamsEnabled && (
          <div className="bg-white rounded-lg border border-gray-200 p-6 text-center">
            <PlugsConnected className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">
              外部サービス連携は現在無効です。管理者に連絡してください。
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
