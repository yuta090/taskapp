'use client'

import Link from 'next/link'
import { ChatCircleDots, Plugs, IdentificationCard, ClipboardText, UsersThree } from '@phosphor-icons/react'

type SecretaryTab = 'messages' | 'approvals' | 'integrations' | 'user-links' | 'group-links'

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
    // 「つなぐ」= LINE連携ハブ(自分/顧問先/グループの3カード)。旧ラベル"LINE連携"は
    // タブ分散の原因の一つだったため、ハブ統合(D3)に合わせて短く汎用的な名前にする。
    key: 'user-links',
    label: 'つなぐ',
    icon: IdentificationCard,
    href: (orgId) => `/${orgId}/secretary/user-links`,
  },
  {
    // 共有botグループ紐付けの承認（Stage 4・PR3a）。promoteのdigest承認("確認待ち"タブ)とは
    // 別概念のため、別タブ・別命名(GroupClaim系)で分離する。approvalsとは相乗りしない。
    key: 'group-links',
    label: '相手先グループ',
    icon: UsersThree,
    href: (orgId) => `/${orgId}/secretary/group-links`,
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
