'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Gear,
  FolderSimple,
  UsersThree,
  Flag,
  GithubLogo,
  ChatCircleDots,
  Calendar,
  VideoCamera,
  Brain,
  Key,
  Export,
  MagnifyingGlass,
} from '@phosphor-icons/react'
import { useIntegrations } from '@/lib/hooks/useIntegrations'
import { useGitHubInstallation } from '@/lib/hooks/useGitHub'
import { useSlackWorkspace } from '@/lib/hooks/useSlack'
import type { IntegrationProvider, IntegrationConnectionSafe } from '@/lib/integrations/types'
import { GeneralSettings } from './GeneralSettings'
import { PresetSettings } from './PresetSettings'
import { MilestonesSettings } from './MilestonesSettings'
import { MembersSettings } from './MembersSettings'
import { GitHubSettings } from './GitHubSettings'
import { SlackSettings } from './SlackSettings'
import { AiSettings } from './AiSettings'
import { GoogleCalendarSettings } from './GoogleCalendarSettings'
import { VideoConferenceSettings } from './VideoConferenceSettings'
import { ApiSettings } from './ApiSettings'
import { ExportSettings } from './ExportSettings'
import { SetupBanner } from './SetupBanner'
import type { SettingSectionId, ConnectionStatus } from './types'

/* ─── Types ─── */

interface SettingItem {
  id: SettingSectionId
  label: string
  icon: React.ElementType
  keywords: string[]
}

interface SettingCategory {
  id: string
  label: string
  items: SettingItem[]
}

interface SettingsLayoutProps {
  orgId: string
  spaceId: string
}

/* ─── Category definitions ─── */

const categories: SettingCategory[] = [
  {
    id: 'project',
    label: 'プロジェクト運用',
    items: [
      { id: 'general', label: '基本設定', icon: FolderSimple, keywords: ['プロジェクト名', '名前', 'name', 'general', 'プリセット', 'テンプレート', 'preset'] },
      { id: 'milestones', label: 'マイルストーン', icon: Flag, keywords: ['期日', 'スケジュール', 'deadline', 'milestone'] },
      { id: 'members', label: 'メンバー', icon: UsersThree, keywords: ['招待', 'ロール', '権限', 'invite', 'role', 'member'] },
    ],
  },
  {
    id: 'integrations',
    label: '外部連携',
    items: [
      { id: 'github', label: 'GitHub', icon: GithubLogo, keywords: ['リポジトリ', 'PR', 'プルリクエスト', 'repository'] },
      { id: 'slack', label: 'Slack', icon: ChatCircleDots, keywords: ['通知', 'チャンネル', 'channel', 'notification'] },
      { id: 'google-calendar', label: 'Google Calendar', icon: Calendar, keywords: ['カレンダー', '空き時間', 'free', 'busy'] },
      { id: 'video-conference', label: 'ビデオ会議', icon: VideoCamera, keywords: ['Zoom', 'Teams', 'Meet', 'ミーティング', 'meeting'] },
    ],
  },
  {
    id: 'automation',
    label: 'AI・自動化',
    items: [{ id: 'ai', label: 'AI設定', icon: Brain, keywords: ['OpenAI', 'Anthropic', 'LLM', 'モデル', 'API key'] }],
  },
  {
    id: 'security',
    label: 'セキュリティ・API',
    items: [{ id: 'api', label: 'APIキー', icon: Key, keywords: ['トークン', 'token', 'key', 'セキュリティ'] }],
  },
  {
    id: 'data',
    label: 'データ管理',
    items: [{ id: 'export', label: 'データエクスポート', icon: Export, keywords: ['CSV', 'ダウンロード', 'download', 'テンプレート'] }],
  },
]

/* ─── Status dot component ─── */

const statusStyles: Record<ConnectionStatus, string> = {
  connected: 'bg-emerald-500',
  disconnected: 'bg-gray-300',
  warning: 'bg-amber-500 animate-pulse',
  none: '',
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  if (status === 'none') return null
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusStyles[status]}`}
      aria-label={
        status === 'connected' ? '接続済み' : status === 'warning' ? '要対応' : '未接続'
      }
    />
  )
}

/* ─── Derive integration statuses from shared data (R1 fix: no duplicate useIntegrations) ─── */

function useIntegrationStatuses(
  orgId: string,
  integrationData: { isConnected: (provider: IntegrationProvider) => boolean; connections: IntegrationConnectionSafe[] },
): Record<SettingSectionId, ConnectionStatus> {
  const { isConnected, connections } = integrationData
  const { data: githubInstallation } = useGitHubInstallation(orgId)
  const { data: slackWorkspace } = useSlackWorkspace(orgId)

  return useMemo(() => {
    const base: Record<SettingSectionId, ConnectionStatus> = {
      general: 'none',
      milestones: 'none',
      members: 'none',
      github: 'none',
      slack: 'none',
      'google-calendar': 'none',
      'video-conference': 'none',
      ai: 'none',
      api: 'none',
      export: 'none',
    }

    base.github = githubInstallation ? 'connected' : 'disconnected'
    base.slack = slackWorkspace ? 'connected' : 'disconnected'
    base['google-calendar'] = isConnected('google_calendar') ? 'connected' : 'disconnected'

    const hasZoom = isConnected('zoom')
    const hasTeams = isConnected('teams')
    const hasMeet = isConnected('google_meet')
    base['video-conference'] = hasZoom || hasTeams || hasMeet ? 'connected' : 'disconnected'

    // Check for expiring tokens — only active connections (C3 fix)
    const now = new Date()
    const warningThreshold = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    for (const conn of connections) {
      if (conn.status !== 'active') continue
      if (conn.token_expires_at) {
        const expiresAt = new Date(conn.token_expires_at)
        if (expiresAt < now) {
          if (conn.provider === 'google_calendar') base['google-calendar'] = 'warning'
          if (conn.provider === 'zoom' || conn.provider === 'teams' || conn.provider === 'google_meet')
            base['video-conference'] = 'warning'
        } else if (expiresAt < warningThreshold) {
          if (conn.provider === 'google_calendar' && base['google-calendar'] !== 'warning')
            base['google-calendar'] = 'warning'
          if (
            (conn.provider === 'zoom' || conn.provider === 'teams' || conn.provider === 'google_meet') &&
            base['video-conference'] !== 'warning'
          )
            base['video-conference'] = 'warning'
        }
      }
    }

    return base
  }, [githubInstallation, slackWorkspace, isConnected, connections])
}

/* ─── Section renderer (C1 fix: PresetSettings embedded in general) ─── */

function SettingsSection({
  sectionId,
  orgId,
  spaceId,
}: {
  sectionId: SettingSectionId
  orgId: string
  spaceId: string
}) {
  switch (sectionId) {
    case 'general':
      return (
        <>
          <GeneralSettings spaceId={spaceId} />
          <hr className="my-6 border-gray-100" />
          <PresetSettings orgId={orgId} spaceId={spaceId} />
        </>
      )
    case 'milestones':
      return <MilestonesSettings spaceId={spaceId} />
    case 'members':
      return <MembersSettings orgId={orgId} spaceId={spaceId} />
    case 'github':
      return <GitHubSettings orgId={orgId} spaceId={spaceId} />
    case 'slack':
      return <SlackSettings orgId={orgId} spaceId={spaceId} />
    case 'google-calendar':
      return <GoogleCalendarSettings orgId={orgId} spaceId={spaceId} />
    case 'video-conference':
      return <VideoConferenceSettings orgId={orgId} spaceId={spaceId} />
    case 'ai':
      return <AiSettings orgId={orgId} spaceId={spaceId} />
    case 'api':
      return <ApiSettings orgId={orgId} spaceId={spaceId} />
    case 'export':
      return <ExportSettings spaceId={spaceId} />
  }
}

/* ─── Component ─── */

export function SettingsLayout({ orgId, spaceId }: SettingsLayoutProps) {
  const [activeSection, setActiveSection] = useState<SettingSectionId>('general')
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // R1 fix: single useIntegrations call shared by statuses + SetupBanner
  const integrations = useIntegrations(orgId)
  const statuses = useIntegrationStatuses(orgId, integrations)
  const activeConnectionCount = useMemo(
    () => integrations.connections.filter((c) => c.status === 'active').length,
    [integrations.connections]
  )

  // Count items needing attention in integrations category
  const attentionCount = useMemo(() => {
    const integrationIds: SettingSectionId[] = ['github', 'slack', 'google-calendar', 'video-conference']
    return integrationIds.filter(
      (id) => statuses[id] === 'warning' || statuses[id] === 'disconnected'
    ).length
  }, [statuses])

  // Filter categories by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories

    const q = searchQuery.toLowerCase()
    return categories
      .map((category) => ({
        ...category,
        items: category.items.filter(
          (item) =>
            item.label.toLowerCase().includes(q) ||
            item.keywords.some((kw) => kw.toLowerCase().includes(q)) ||
            category.label.toLowerCase().includes(q)
        ),
      }))
      .filter((category) => category.items.length > 0)
  }, [searchQuery])

  // Keyboard shortcut: Cmd+K or / to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  const handleNavigate = useCallback((sectionId: SettingSectionId) => {
    setActiveSection(sectionId)
    setSearchQuery('')
  }, [])

  return (
    <div className="flex-1 min-h-0 flex">
      {/* Settings sidebar nav */}
      <nav className="w-[200px] flex-shrink-0 border-r border-gray-100 overflow-y-auto py-4 px-2">
        {/* Search */}
        <div className="px-2 mb-4">
          <div className="relative">
            <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-7 pr-2 py-1.5 text-[13px] text-gray-700 bg-gray-50 border border-gray-200 rounded-md placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-300 focus:border-indigo-300"
            />
            {!searchQuery && (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400 bg-gray-100 px-1 py-0.5 rounded border border-gray-200">
                /
              </kbd>
            )}
          </div>
        </div>

        {filteredCategories.map((category) => (
          <div key={category.id} className="mb-4">
            <div className="px-2 mb-1 flex items-center justify-between">
              <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
                {category.label}
              </span>
              {category.id === 'integrations' && attentionCount > 0 && !searchQuery && (
                <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">
                  {attentionCount}
                </span>
              )}
            </div>
            {category.items.map((item) => {
              const Icon = item.icon
              const isActive = activeSection === item.id
              const status = statuses[item.id]
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item.id)}
                  className={`
                    w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-[13px] transition-colors cursor-pointer
                    ${isActive
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                    }
                  `}
                >
                  <Icon
                    className={`text-base flex-shrink-0 ${isActive ? 'text-gray-700' : 'text-gray-400'}`}
                    weight={isActive ? 'fill' : 'regular'}
                  />
                  <span className="truncate flex-1 text-left">{item.label}</span>
                  <StatusDot status={status} />
                </button>
              )
            })}
          </div>
        ))}

        {filteredCategories.length === 0 && searchQuery && (
          <div className="px-2 py-4 text-center">
            <p className="text-xs text-gray-400">「{searchQuery}」に一致する設定はありません</p>
          </div>
        )}
      </nav>

      {/* Settings content area */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="max-w-[800px] mx-auto px-6 py-6">
          <SetupBanner
            orgId={orgId}
            spaceId={spaceId}
            onNavigate={handleNavigate}
            activeConnectionCount={activeConnectionCount}
          />
          <section className="bg-white border border-gray-200 rounded-xl p-6">
            <SettingsSection sectionId={activeSection} orgId={orgId} spaceId={spaceId} />
          </section>
        </div>
      </div>
    </div>
  )
}
