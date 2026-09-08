'use client'

import { Bell, BellSlash, Envelope, DeviceMobile } from '@phosphor-icons/react'
import Link from 'next/link'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'
import { useDueReminderPreference } from '@/lib/hooks/useDueReminderPreference'
import { useNotificationEmailPrefs } from '@/lib/hooks/useNotificationEmailPrefs'
import { SettingsBackButton } from '@/components/shared'
import { readPushEnvironment } from '@/lib/push/environment'
import { useClientSnapshot } from '@/lib/hooks/useClientSnapshot'

export default function NotificationSettingsPage() {
  const { user, loading: userLoading } = useCurrentUser()

  // 枠(ヘッダーとカードの外形)は必ず描き、中身だけ差し替える。
  // 全画面スピナーにすると、永続キャッシュの復元が終わるまで毎回まっさらな白画面になる
  // （速いページの型: 在庫があれば即描画・無くても枠は出す）。
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-surface border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <SettingsBackButton />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">通知設定</h1>
              <p className="text-sm text-gray-500">通知の受け取り設定</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {userLoading ? (
          <NotificationSettingsSkeleton />
        ) : !user ? (
          <SignedOutNotice />
        ) : (
          <NotificationSettingsBody userId={user.id} />
        )}
      </main>
    </div>
  )
}

function NotificationSettingsSkeleton() {
  return (
    <div className="space-y-6" data-testid="notification-settings-skeleton">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 bg-surface rounded-lg border border-gray-200 animate-pulse" />
      ))}
    </div>
  )
}

function SignedOutNotice() {
  return (
    <div className="text-center py-16">
      <p className="text-gray-600 mb-4">ログインが必要です</p>
      <Link href="/login" className="text-indigo-600 hover:underline">
        ログインページへ
      </Link>
    </div>
  )
}

function NotificationSettingsBody({ userId }: { userId: string }) {
  const push = usePushNotifications()
  // iPhone は「ホーム画面に追加」しないと通知を扱えない。素朴に見ると非対応に見えるので
  // 環境を分けて案内する。サーバー側では分からないので null（案内を出さない）から始める
  const pushEnv = useClientSnapshot(readPushEnvironment, null)
  // メール通知の受信設定。notification_email_prefs を楽観更新＝実際に効く。
  const { prefs, update, loading: prefsLoading } = useNotificationEmailPrefs(userId)

  return (
    <>
        {/* Browser Push Notifications */}
        <div className="bg-surface rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {push.isSubscribed ? (
                <Bell className="w-6 h-6 text-indigo-600" />
              ) : (
                <BellSlash className="w-6 h-6 text-gray-400" />
              )}
              <div>
                <h3 className="text-sm font-medium text-gray-900">ブラウザ通知</h3>
                <p className="text-xs text-gray-500">
                  承認依頼や、あなたに番が回ってきたときだけ通知します。
                  夜9時〜朝8時と土日は鳴りません
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={push.isSubscribed}
              aria-label="ブラウザ通知を有効にする"
              disabled={!push.isSupported || push.permission === 'denied' || push.loading}
              onClick={() => void (push.isSubscribed ? push.disable() : push.enable())}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                push.isSubscribed ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                  push.isSubscribed ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          {!push.isSupported && pushEnv === 'ios_needs_home_screen' && (
            <div className="mt-3 text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 space-y-1">
              <p className="flex items-center gap-1.5 font-medium text-gray-900">
                <DeviceMobile className="w-4 h-4" />
                iPhone・iPad で受け取るには、ホーム画面に追加してください
              </p>
              <p>
                Safari の共有ボタン（□に↑）→「ホーム画面に追加」→ 追加されたアイコンから開き、
                この画面でもう一度スイッチを入れると通知が届くようになります。
              </p>
            </div>
          )}
          {!push.isSupported && pushEnv === 'unsupported' && (
            <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
              このブラウザはプッシュ通知に対応していません。
            </p>
          )}
          {push.isSupported && push.permission === 'denied' && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">
              ブラウザの設定で通知がブロックされています。アドレスバーのサイト設定から許可してください
            </p>
          )}
          {push.error && (
            <p className="mt-3 text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{push.error}</p>
          )}
        </div>

        {/* 期限リマインド受信（実装済み・実際に効く設定） */}
        <DueReminderToggle userId={userId} />

        {/* Digest info notice */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-600">
            <Envelope className="w-5 h-5" />
            <span className="font-medium">急ぎのものだけすぐ、それ以外は1日1回のまとめで</span>
          </div>
          <ul className="text-sm text-blue-600 mt-1 space-y-0.5 list-disc list-inside">
            <li>承認依頼など「あなたの返事を待っている件」は、数分ぶんをまとめてすぐお送りします</li>
            <li>それ以外は1日分をまとめて1通。受け取る種類と頻度は下で選べます</li>
            <li>夜9時〜朝8時と土日は、すぐ送るぶんを止めて翌営業日の朝にまわします</li>
          </ul>
        </div>

        {/* Email Master Toggle */}
        <div className="bg-surface rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {prefs.email_enabled ? (
                <Bell className="w-6 h-6 text-indigo-600" />
              ) : (
                <BellSlash className="w-6 h-6 text-gray-400" />
              )}
              <div>
                <h3 className="text-sm font-medium text-gray-900">メール通知</h3>
                <p className="text-xs text-gray-500">
                  すべてのメール通知を有効/無効にします
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.email_enabled}
              aria-label="メール通知を有効にする"
              onClick={() => void update({ email_enabled: !prefs.email_enabled })}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                prefs.email_enabled ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
                  prefs.email_enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Individual Settings */}
        <div className="bg-surface rounded-lg border border-gray-200 divide-y divide-gray-100">
          <div className="p-4">
            <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <Bell className="w-4 h-4" />
              通知の種類
            </h3>
            <p className="text-xs text-gray-500 mt-0.5">
              メールとブラウザ通知の両方に効きます。切った種類はどちらにも届きません
            </p>
          </div>

          {/* 取得できるまでは既定値(全部オン)で描いてしまい、実際は切っている人に
              「全部オン → 数百msでオフへパタパタ」が見える。初回だけ骨組みを出す
              （2回目以降は永続キャッシュに在庫があるので即描画される） */}
          {prefsLoading ? (
            <div className="p-4 space-y-3" data-testid="notification-types-skeleton">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <>
          {/* Task Assigned */}
          <SettingRow
            label="タスク割り当て"
            description="タスクがあなたに割り当てられた／ボールが回ってきた時"
            enabled={prefs.on_task_assigned}
            onChange={() => void update({ on_task_assigned: !prefs.on_task_assigned })}
          />

          {/* Mentioned */}
          <SettingRow
            label="メンション"
            description="コメントであなたがメンションされた時"
            enabled={prefs.on_task_mentioned}
            onChange={() => void update({ on_task_mentioned: !prefs.on_task_mentioned })}
          />

          {/* Review Request */}
          <SettingRow
            label="社内承認依頼"
            description="社内承認・レビューを依頼された時"
            enabled={prefs.on_review_request}
            onChange={() => void update({ on_review_request: !prefs.on_review_request })}
          />

          {/* Client Response */}
          <SettingRow
            label="相手からの応答・承諾"
            description="相手先やメンバーが確認・回答した時、招待を承諾した時"
            enabled={prefs.on_client_response}
            onChange={() => void update({ on_client_response: !prefs.on_client_response })}
          />

          {/* Meeting Reminder */}
          <SettingRow
            label="会議リマインダー"
            description="予定された会議の前"
            enabled={prefs.on_meeting_reminder}
            onChange={() => void update({ on_meeting_reminder: !prefs.on_meeting_reminder })}
          />
            </>
          )}
        </div>

        {/* Digest Settings */}
        <fieldset className="bg-surface rounded-lg border border-gray-200 p-6 space-y-4">
          <legend className="text-sm font-medium text-gray-900">ダイジェストメール</legend>
          <p className="text-xs text-gray-500">
            まとめメールを受け取る頻度を選択します（「オフ」でメールを止められます）
          </p>
          <div className="flex gap-2">
            {[
              { value: 'none', label: 'オフ' },
              { value: 'daily', label: '毎日' },
              { value: 'weekly', label: '毎週' },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`px-4 py-2 text-sm rounded-lg border cursor-pointer ${
                  prefs.digest_frequency === opt.value
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-ink font-medium'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                }`}
              >
                <input
                  type="radio"
                  name="digest_frequency"
                  value={opt.value}
                  checked={prefs.digest_frequency === opt.value}
                  onChange={() => void update({ digest_frequency: opt.value as 'none' | 'daily' | 'weekly' })}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

    </>
  )
}

/**
 * 期限リマインド受信トグル（実装済み・実際に効く設定）。
 * profiles.due_reminder_enabled を楽観更新する。sender が送信直前に参照し、
 * false なら自動リマインドを送らない。保存ボタンは無い（規約）。
 */
function DueReminderToggle({ userId }: { userId: string }) {
  const { enabled, toggle, saving, loading } = useDueReminderPreference(userId)

  // 取得中はこのカードだけ非表示（ページ全体はブロックしない）。永続キャッシュ在庫があれば即描画。
  if (loading) return null

  return (
    <div className="bg-surface rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {enabled ? (
            <Bell className="w-6 h-6 text-indigo-600" />
          ) : (
            <BellSlash className="w-6 h-6 text-gray-400" />
          )}
          <div>
            <h3 className="text-sm font-medium text-gray-900">期限リマインド</h3>
            <p className="text-xs text-gray-500">
              期限が近いタスクの自動リマインドを受け取ります（手動リマインドやアプリ内通知には影響しません）
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="期限リマインドを受け取る"
          disabled={saving}
          onClick={() => void toggle()}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            enabled ? 'bg-indigo-600' : 'bg-gray-200'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-surface transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  )
}

function SettingRow({
  label,
  description,
  enabled,
  disabled = false,
  onChange,
}: {
  label: string
  description: string
  enabled: boolean
  /** 種類の選択はメールのオン/オフに連動しない（ブラウザ通知にも効くため）。既定は操作可 */
  disabled?: boolean
  onChange: () => void
}) {
  const id = label.replace(/\s+/g, '-').toLowerCase()

  return (
    <label
      className={`flex items-center justify-between p-4 cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}`}
    >
      <div>
        <span id={`${id}-label`} className="text-sm font-medium text-gray-900">{label}</span>
        <p id={`${id}-desc`} className="text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        onClick={onChange}
        disabled={disabled}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          enabled ? 'bg-indigo-600' : 'bg-gray-200'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}
