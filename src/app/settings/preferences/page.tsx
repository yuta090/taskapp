'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import { Sun, Moon, Desktop, Globe, Clock, SidebarSimple } from '@phosphor-icons/react'
import { SettingsBackButton } from '@/components/shared'

type Theme = 'light' | 'dark' | 'system'
type Language = 'ja' | 'en'

const PREFS_KEYS = {
  theme: 'taskapp:prefs:theme',
  language: 'taskapp:prefs:language',
  timezone: 'taskapp:prefs:timezone',
  sidebarCollapsed: 'taskapp:sidebar:internal:collapsed',
} as const

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Tokyo', label: '日本標準時 (JST, UTC+9)' },
  { value: 'America/New_York', label: '東部標準時 (EST, UTC-5)' },
  { value: 'America/Los_Angeles', label: '太平洋標準時 (PST, UTC-8)' },
  { value: 'Europe/London', label: 'グリニッジ標準時 (GMT, UTC+0)' },
  { value: 'Europe/Berlin', label: '中央ヨーロッパ時間 (CET, UTC+1)' },
  { value: 'Asia/Shanghai', label: '中国標準時 (CST, UTC+8)' },
  { value: 'Asia/Seoul', label: '韓国標準時 (KST, UTC+9)' },
  { value: 'Australia/Sydney', label: 'オーストラリア東部時間 (AEST, UTC+10)' },
]

interface Preferences {
  theme: Theme
  language: Language
  timezone: string
  sidebarCollapsed: boolean
}

function loadPreferences(): Preferences {
  if (typeof window === 'undefined') {
    return { theme: 'light', language: 'ja', timezone: 'Asia/Tokyo', sidebarCollapsed: false }
  }
  return {
    theme: (localStorage.getItem(PREFS_KEYS.theme) as Theme) || 'light',
    language: (localStorage.getItem(PREFS_KEYS.language) as Language) || 'ja',
    timezone: localStorage.getItem(PREFS_KEYS.timezone) || 'Asia/Tokyo',
    sidebarCollapsed: localStorage.getItem(PREFS_KEYS.sidebarCollapsed) === 'true',
  }
}

const emptySubscribe = () => () => {}

export default function PreferencesSettingsPage() {
  const [prefs, setPrefs] = useState<Preferences>({ theme: 'light', language: 'ja', timezone: 'Asia/Tokyo', sidebarCollapsed: false })
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false)

  // Sync with localStorage after hydration (cannot read during SSR)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with external storage (localStorage)
  useEffect(() => { setPrefs(loadPreferences()) }, [])

  const { theme, language, timezone, sidebarCollapsed } = prefs

  const updatePref = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
    const storageKey = PREFS_KEYS[key === 'sidebarCollapsed' ? 'sidebarCollapsed' : key]
    localStorage.setItem(storageKey, String(value))
    // テーマ変更は同一タブの ThemeSync に即時反映させる（保存ボタン無し・楽観適用）
    if (key === 'theme') {
      window.dispatchEvent(new Event('taskapp:theme-change'))
    }
  }

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-surface border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <SettingsBackButton />
            <div>
              <h1 className="text-xl font-semibold text-gray-900">環境設定</h1>
              <p className="text-sm text-gray-500">表示やUIのカスタマイズ</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Theme */}
        <div className="bg-surface rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Sun className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-900">テーマ</h3>
          </div>
          <p className="text-xs text-gray-500">アプリの外観を選択します</p>
          <div className="flex gap-3">
            {([
              { value: 'light' as Theme, label: 'ライト', icon: <Sun className="w-4 h-4" />, disabled: false },
              { value: 'dark' as Theme, label: 'ダーク', icon: <Moon className="w-4 h-4" />, disabled: false },
              { value: 'system' as Theme, label: 'システム', icon: <Desktop className="w-4 h-4" />, disabled: false },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => updatePref('theme', opt.value)}
                disabled={opt.disabled}
                title={opt.disabled ? '準備中' : undefined}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg border transition-colors ${
                  theme === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-surface text-gray-700 hover:bg-gray-50'
                } ${opt.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {opt.icon}
                {opt.label}
                {opt.disabled && <span className="text-[10px] text-gray-400">準備中</span>}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            「システム」はお使いの端末の設定に自動で合わせます。ダークはログイン後のアプリ画面に適用されます（マーケ・診断・クライアント向けポータルは常にライトです）。
          </p>
        </div>

        {/* Language */}
        <div className="bg-surface rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-900">言語</h3>
          </div>
          <p className="text-xs text-gray-500">UIの表示言語を選択します</p>
          <div className="flex gap-3">
            {([
              { value: 'ja' as Language, label: '日本語', disabled: false },
              { value: 'en' as Language, label: 'English', disabled: true },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => updatePref('language', opt.value)}
                disabled={opt.disabled}
                title={opt.disabled ? '準備中' : undefined}
                className={`px-4 py-2.5 text-sm rounded-lg border transition-colors ${
                  language === opt.value
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                    : 'border-gray-200 bg-surface text-gray-700 hover:bg-gray-50'
                } ${opt.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {opt.label}
                {opt.disabled && <span className="ml-1 text-[10px] text-gray-400">準備中</span>}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">
            英語UIは現在準備中です。今は「日本語」のみご利用いただけます。
          </p>
        </div>

        {/* Timezone */}
        <div className="bg-surface rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-900">タイムゾーン</h3>
          </div>
          <p className="text-xs text-gray-500">日時の表示に使用するタイムゾーン</p>
          <select
            value={timezone}
            onChange={e => updatePref('timezone', e.target.value)}
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {TIMEZONE_OPTIONS.map(tz => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>

        {/* Sidebar Default State */}
        <div className="bg-surface rounded-lg border border-gray-200 p-6 space-y-4">
          <div className="flex items-center gap-2">
            <SidebarSimple className="w-4 h-4 text-gray-500" />
            <h3 className="text-sm font-medium text-gray-900">サイドバー</h3>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700">デフォルトで折りたたむ</p>
              <p className="text-xs text-gray-500">サイドバーを折りたたんだ状態で開始</p>
            </div>
            <button
              onClick={() => updatePref('sidebarCollapsed', !sidebarCollapsed)}
              role="switch"
              aria-checked={sidebarCollapsed}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                sidebarCollapsed ? 'bg-indigo-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-surface transition-transform ${
                  sidebarCollapsed ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
