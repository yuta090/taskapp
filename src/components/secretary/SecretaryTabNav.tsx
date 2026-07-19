'use client'

import Link from 'next/link'
import { ChatCircleDots, Plugs, IdentificationCard, ClipboardText } from '@phosphor-icons/react'

type SecretaryTab = 'messages' | 'approvals' | 'integrations' | 'connect'

interface SecretaryTabNavProps {
  orgId: string
  activeTab: SecretaryTab
}

const tabs: { key: SecretaryTab; label: string; icon: typeof ChatCircleDots; href: (orgId: string) => string }[] = [
  { key: 'messages', label: 'メッセージ', icon: ChatCircleDots, href: (orgId) => `/${orgId}/secretary` },
  {
    key: 'approvals',
    label: '確認待ち',
    icon: ClipboardText,
    href: (orgId) => `/${orgId}/secretary/approvals`,
  },
  { key: 'integrations', label: '外部連携', icon: Plugs, href: (orgId) => `/${orgId}/secretary/integrations` },
  {
    // 「つなぐ」= チャネル連携ハブ。LINE/Slack/Teams…をチャネル軸で束ね、自分/相手先/
    // グループの各フローはLINE配下(/secretary/connect/line)に集約する。チャネルごとに
    // トップタブを増やさず、チャネル追加は /connect/<channel> の追加だけで済ませる骨格。
    key: 'connect',
    label: 'つなぐ',
    icon: IdentificationCard,
    href: (orgId) => `/${orgId}/secretary/connect/line`,
  },
]

/**
 * 秘書コンソールのタブ切替（メッセージ/連携）。ViewsTabNav(gantt/burndown)と同型:
 * ルートベースのタブで各page.tsxが独立してデータ取得する(docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4)。
 */
export function SecretaryTabNav({ orgId, activeTab }: SecretaryTabNavProps) {
  return (
    <div className="flex items-center gap-1 px-4 pt-2 bg-white border-b border-gray-200 flex-shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab
        const Icon = tab.icon
        return (
          <Link
            key={tab.key}
            href={tab.href(orgId)}
            data-testid={`secretary-tab-${tab.key}`}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t transition-colors ${
              isActive
                ? 'text-gray-900 bg-gray-50 border border-gray-200 border-b-transparent -mb-px'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
