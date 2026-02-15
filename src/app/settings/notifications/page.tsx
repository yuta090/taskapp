'use client'

import { useState, useEffect, useMemo } from 'react'
import { ArrowLeft, Bell, BellSlash, Envelope, CircleNotch, Check } from '@phosphor-icons/react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'

interface NotificationSettings {
  email_enabled: boolean
  email_on_task_assigned: boolean
  email_on_task_mentioned: boolean
  email_on_review_request: boolean
  email_on_client_response: boolean
  email_on_meeting_reminder: boolean
  email_digest_frequency: 'none' | 'daily' | 'weekly'
}

const DEFAULT_SETTINGS: NotificationSettings = {
  email_enabled: true,
  email_on_task_assigned: true,
  email_on_task_mentioned: true,
  email_on_review_request: true,
  email_on_client_response: true,
  email_on_meeting_reminder: true,
  email_digest_frequency: 'daily',
}

export default function NotificationSettingsPage() {
  const { user, loading: userLoading } = useCurrentUser()
  const [settings, setSettings] = useState<NotificationSettings>(DEFAULT_SETTINGS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const supabase = useMemo(() => createClient(), [])

  // Fetch notification settings
  useEffect(() => {
    if (!userLoading && !user) {
      setLoading(false)
      return
    }
    if (!user) return

    const fetchSettings = async () => {
      setLoading(true)
      try {
        // Note: notification_settings table would need to be created
        // For now, use defaults and show as "準備中"
        // const { data, error } = await (supabase as SupabaseClient)
        //   .from('user_notification_settings')
        //   .select('*')
        //   .eq('user_id', user.id)
        //   .maybeSingle()

        // Use defaults for now
        setSettings(DEFAULT_SETTINGS)
      } catch (err) {
        console.error('Failed to fetch notification settings:', err)
      } finally {
        setLoading(false)
      }
    }

    void fetchSettings()
  }, [user, userLoading, supabase])

  const handleToggle = (key: keyof NotificationSettings) => {
    if (typeof settings[key] === 'boolean') {
      setSettings((prev) => ({
        ...prev,
        [key]: !prev[key],
      }))
    }
  }

  const handleDigestChange = (frequency: 'none' | 'daily' | 'weekly') => {
    setSettings((prev) => ({
      ...prev,
      email_digest_frequency: frequency,
    }))
  }

  const handleSave = async () => {
    if (!user) return

    setSaving(true)
    setMessage(null)

    try {
      // Note: Would save to user_notification_settings table
      // For now, just show success message
      await new Promise((resolve) => setTimeout(resolve, 500))
      setMessage({ type: 'success', text: '通知設定を保存しました（デモ）' })
    } catch (err) {
      console.error('Failed to save notification settings:', err)
      setMessage({ type: 'error', text: '通知設定の保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  if (userLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <CircleNotch className="w-8 h-8 text-indigo-500 animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">ログインが必要です</p>
          <Link href="/login" className="text-indigo-600 hover:underline">
            ログインページへ
          </Link>
        </div>
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
              aria-label="戻る"
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" aria-hidden="true" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">通知設定</h1>
              <p className="text-sm text-gray-500">メール通知の設定</p>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Message */}
        {message && (
          <div
            role={message.type === 'error' ? 'alert' : 'status'}
            className={`p-4 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Coming soon notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-blue-700">
            <Bell className="w-5 h-5" />
            <span className="font-medium">メール通知機能は準備中です</span>
          </div>
          <p className="text-sm text-blue-600 mt-1">
            以下の設定は今後のアップデートで有効になります。
          </p>
        </div>

        {/* Email Master Toggle */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {settings.email_enabled ? (
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
              aria-checked={settings.email_enabled}
              aria-label="メール通知を有効にする"
              onClick={() => handleToggle('email_enabled')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings.email_enabled ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.email_enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Individual Settings */}
        <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          <div className="p-4">
            <h3 className="text-sm font-medium text-gray-900 flex items-center gap-2">
              <Envelope className="w-4 h-4" />
              通知タイプ
            </h3>
          </div>

          {/* Task Assigned */}
          <SettingRow
            label="タスク割り当て"
            description="タスクがあなたに割り当てられた時"
            enabled={settings.email_enabled && settings.email_on_task_assigned}
            disabled={!settings.email_enabled}
            onChange={() => handleToggle('email_on_task_assigned')}
          />

          {/* Mentioned */}
          <SettingRow
            label="メンション"
            description="コメントであなたがメンションされた時"
            enabled={settings.email_enabled && settings.email_on_task_mentioned}
            disabled={!settings.email_enabled}
            onChange={() => handleToggle('email_on_task_mentioned')}
          />

          {/* Review Request */}
          <SettingRow
            label="承認依頼"
            description="承認を依頼された時"
            enabled={settings.email_enabled && settings.email_on_review_request}
            disabled={!settings.email_enabled}
            onChange={() => handleToggle('email_on_review_request')}
          />

          {/* Client Response */}
          <SettingRow
            label="クライアント応答"
            description="クライアントが確認・回答した時"
            enabled={settings.email_enabled && settings.email_on_client_response}
            disabled={!settings.email_enabled}
            onChange={() => handleToggle('email_on_client_response')}
          />

          {/* Meeting Reminder */}
          <SettingRow
            label="会議リマインダー"
            description="予定された会議の前日"
            enabled={settings.email_enabled && settings.email_on_meeting_reminder}
            disabled={!settings.email_enabled}
            onChange={() => handleToggle('email_on_meeting_reminder')}
          />
        </div>

        {/* Digest Settings */}
        <fieldset className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <legend className="text-sm font-medium text-gray-900">ダイジェストメール</legend>
          <p className="text-xs text-gray-500">
            未読通知のまとめメールを受け取る頻度を選択します
          </p>
          <div className="flex gap-2">
            {[
              { value: 'none', label: 'オフ' },
              { value: 'daily', label: '毎日' },
              { value: 'weekly', label: '毎週' },
            ].map((opt) => (
              <label
                key={opt.value}
                className={`px-4 py-2 text-sm rounded-lg border transition-colors cursor-pointer ${
                  settings.email_digest_frequency === opt.value
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-medium'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                } ${!settings.email_enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="digest_frequency"
                  value={opt.value}
                  checked={settings.email_digest_frequency === opt.value}
                  onChange={() => handleDigestChange(opt.value as 'none' | 'daily' | 'weekly')}
                  disabled={!settings.email_enabled}
                  className="sr-only"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </fieldset>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {saving ? (
              <CircleNotch className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {saving ? '保存中...' : '設定を保存'}
          </button>
        </div>
      </main>
    </div>
  )
}

function SettingRow({
  label,
  description,
  enabled,
  disabled,
  onChange,
}: {
  label: string
  description: string
  enabled: boolean
  disabled: boolean
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
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            enabled ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}
