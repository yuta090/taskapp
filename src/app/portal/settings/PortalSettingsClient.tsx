'use client'

import { User, Envelope, Bell, Shield, CalendarCheck, Trash, Info } from '@phosphor-icons/react'
import { PortalShell } from '@/components/portal'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import { isGoogleCalendarConfigured } from '@/lib/google-calendar/config'
import { IntegrationStatusBadge, SetupGuide } from '@/components/integrations'

interface Project {
  id: string
  name: string
  orgId: string
  orgName?: string
}

interface UserInfo {
  id: string
  email: string
  displayName: string
  avatarUrl?: string
}

interface PortalSettingsClientProps {
  currentProject: Project
  projects: Project[]
  user: UserInfo
  actionCount?: number
}

export function PortalSettingsClient({
  currentProject,
  projects,
  user,
  actionCount = 0,
}: PortalSettingsClientProps) {
  const isGCalEnabled = isGoogleCalendarConfigured()
  const {
    loading: gCalLoading,
    connectGoogle,
    disconnect: gCalDisconnect,
    getConnection: getGCalConnection,
    isConnected: isGCalConnected,
  } = useIntegrations(currentProject.orgId)

  const googleConnection = getGCalConnection('google_calendar')

  const handleGCalDisconnect = async () => {
    if (!googleConnection) return
    if (!confirm('Google Calendar連携を解除しますか？')) return
    await gCalDisconnect(googleConnection.id)
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
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
    >
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* Page Header */}
          <div>
            <h1 className="text-2xl font-bold text-gray-900">設定</h1>
            <p className="mt-1 text-sm text-gray-600">
              アカウント設定と通知の管理
            </p>
          </div>

          {/* Profile Section */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-gray-500" />
                <h2 className="font-medium text-gray-900">プロフィール</h2>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-white flex items-center justify-center text-2xl font-bold shadow-md">
                  {user.displayName.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{user.displayName}</p>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Email Notifications */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-gray-500" />
                <h2 className="font-medium text-gray-900">通知設定</h2>
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">メール通知</p>
                  <p className="text-xs text-gray-500">新しいタスクや更新をメールで受け取る</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">期限リマインダー</p>
                  <p className="text-xs text-gray-500">期限が近いタスクを事前に通知</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" defaultChecked className="sr-only peer" />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                </label>
              </div>
            </div>
          </div>

          {/* Connected Email */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <Envelope className="w-5 h-5 text-gray-500" />
                <h2 className="font-medium text-gray-900">メールアドレス</h2>
              </div>
            </div>
            <div className="p-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <Envelope className="w-5 h-5 text-gray-400" />
                <span className="text-sm text-gray-700">{user.email}</span>
                <span className="ml-auto px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">認証済み</span>
              </div>
            </div>
          </div>

          {/* Google Calendar */}
          {isGCalEnabled && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <CalendarCheck className="w-5 h-5 text-gray-500" />
                  <h2 className="font-medium text-gray-900">Google Calendar 連携</h2>
                </div>
              </div>
              <div className="p-4 space-y-4">
                {gCalLoading ? (
                  <div className="text-sm text-gray-500">読み込み中...</div>
                ) : isGCalConnected('google_calendar') && googleConnection ? (
                  <div className="space-y-3">
                    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-600">ステータス:</span>
                          <IntegrationStatusBadge status="active" />
                        </div>
                        <button
                          onClick={handleGCalDisconnect}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="連携を解除"
                          data-testid="portal-google-calendar-disconnect"
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
                        <span className="text-gray-500">最終同期: </span>
                        <span className="text-gray-700">
                          {formatDate(googleConnection.last_refreshed_at || googleConnection.updated_at)}
                        </span>
                      </div>

                      {/* Setup guide - collapsed when connected */}
                      <SetupGuide defaultOpen={false}>
                        <p>
                          あなたのGoogleカレンダーと連携すると、候補日の空き状況を自動で共有できます。
                        </p>
                        <div className="flex items-start gap-2">
                          <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                          <span>共有されるのは空き/埋まり情報のみです。予定の詳細は読み取りません。</span>
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
                  <div className="border border-gray-200 rounded-lg p-4 space-y-4">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-600">ステータス:</span>
                      <IntegrationStatusBadge status="disconnected" />
                    </div>

                    {/* Setup guide - open when disconnected */}
                    <SetupGuide defaultOpen={true}>
                      <p>
                        あなたのGoogleカレンダーと連携すると、候補日の空き状況を自動で共有できます。
                      </p>
                      <div className="flex items-start gap-2">
                        <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                        <span>共有されるのは空き/埋まり情報のみです。予定の詳細は読み取りません。</span>
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
                      data-testid="portal-google-calendar-connect"
                    >
                      <CalendarCheck weight="bold" />
                      Googleアカウントを接続
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Security */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-gray-500" />
                <h2 className="font-medium text-gray-900">セキュリティ</h2>
              </div>
            </div>
            <div className="p-4">
              <button
                type="button"
                className="text-sm text-amber-600 hover:text-amber-700 font-medium"
              >
                パスワードを変更
              </button>
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  )
}
