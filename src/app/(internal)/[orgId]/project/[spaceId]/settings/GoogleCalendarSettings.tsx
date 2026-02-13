'use client'

import { CalendarCheck, Trash, Info } from '@phosphor-icons/react'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar/config'
import { IntegrationStatusBadge, SetupGuide } from '@/components/integrations'

interface GoogleCalendarSettingsProps {
  orgId: string
  spaceId: string
}

export function GoogleCalendarSettings({ orgId }: GoogleCalendarSettingsProps) {
  const {
    loading,
    error,
    connectGoogle,
    disconnect,
    getConnection,
    isConnected,
  } = useIntegrations(orgId)

  const isEnabled = isGoogleCalendarConfigured()

  if (!isEnabled) {
    return null
  }

  const googleConnection = getConnection('google_calendar')
  const connected = isConnected('google_calendar')

  const handleDisconnect = async () => {
    if (!googleConnection) return
    if (!confirm('Google Calendar連携を解除しますか？')) return
    await disconnect(googleConnection.id)
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-gray-700">
        <CalendarCheck className="text-lg" weight="bold" />
        <h3 className="font-medium">Google Calendar 連携</h3>
      </div>

      {loading ? (
        <div className="p-4 text-sm text-gray-500">読み込み中...</div>
      ) : error ? (
        <div className="p-4 text-sm text-red-600 bg-red-50 rounded-lg">
          {error.message}
        </div>
      ) : connected && googleConnection ? (
        <div className="space-y-3">
          {/* Connected state */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-gray-600">ステータス:</span>
                <IntegrationStatusBadge status="active" />
              </div>
              <button
                onClick={handleDisconnect}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                title="連携を解除"
                data-testid="google-calendar-disconnect"
              >
                <Trash className="text-sm" />
              </button>
            </div>

            {(() => {
              const meta = googleConnection.metadata as Record<string, unknown> | null
              const email = meta?.email
              if (!email) return null
              return (
                <div className="text-sm">
                  <span className="text-gray-500">アカウント: </span>
                  <span className="text-gray-700">{String(email)}</span>
                </div>
              )
            })()}

            <div className="text-sm">
              <span className="text-gray-500">スコープ: </span>
              <span className="text-gray-700">
                {googleConnection.scopes || 'calendar.freebusy'}
              </span>
            </div>

            <div className="text-sm">
              <span className="text-gray-500">最終同期: </span>
              <span className="text-gray-700">
                {formatDate(googleConnection.last_refreshed_at || googleConnection.updated_at)}
              </span>
            </div>

            {/* Setup guide - collapsed when connected */}
            <SetupGuide defaultOpen={false}>
              <p>
                Google Calendar と連携すると、日程調整の候補日に参加者の予定を自動で確認できます。
              </p>
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                <span>取得するのは空き/埋まり情報のみです。予定の詳細は読み取りません。</span>
              </div>
              <ol className="list-decimal list-inside space-y-1 text-gray-600">
                <li>「Googleアカウントを接続」をクリック</li>
                <li>Googleアカウントでログイン</li>
                <li>「カレンダーの空き情報の参照」を許可</li>
                <li>自動的にこの画面に戻ります</li>
              </ol>
              <div className="flex items-start gap-2 text-gray-500">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>接続はいつでも解除できます。</span>
              </div>
            </SetupGuide>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Disconnected state */}
          <div className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">ステータス:</span>
              <IntegrationStatusBadge status="disconnected" />
            </div>

            {/* Setup guide - open when disconnected */}
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
              <div className="flex items-start gap-2 text-gray-500">
                <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>接続はいつでも解除できます。</span>
              </div>
            </SetupGuide>

            <button
              onClick={connectGoogle}
              className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              data-testid="google-calendar-connect"
            >
              <CalendarCheck weight="bold" />
              Googleアカウントを接続
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
