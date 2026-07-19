'use client'

import Link from 'next/link'
import { ChatCircle, SlackLogo, MicrosoftTeamsLogo } from '@phosphor-icons/react'

type ChannelKey = 'line' | 'slack' | 'teams'

interface ChannelRailProps {
  orgId: string
  /** 現在表示中のチャネル。有効なチャネルのみ(現状 line)。 */
  activeChannel: ChannelKey
}

/**
 * 「つなぐ」ハブの左レール（チャネル軸のサイドメニュー）。
 *
 * 受信チャネル(双方向チャット)を縦に並べる。現状つなげるのは LINE のみで、
 * Slack / Teams は「近日」の非クリック行として枠だけ見せる（Pro=マルチチャネル
 * ハブの方向性を提示しつつ、route の無いチャネルへ遷移させない）。
 *
 * チャネル追加時はこの配列に1行足し、/secretary/connect/<channel> を作るだけ。
 * トップタブ(SecretaryTabNav)は増やさない — フラットなタブ増殖を防ぐ骨格。
 */
const channels: {
  key: ChannelKey
  label: string
  icon: typeof ChatCircle
  href: (orgId: string) => string | null
  soon?: boolean
}[] = [
  { key: 'line', label: 'LINE', icon: ChatCircle, href: (orgId) => `/${orgId}/secretary/connect/line` },
  { key: 'slack', label: 'Slack', icon: SlackLogo, href: () => null, soon: true },
  { key: 'teams', label: 'Teams', icon: MicrosoftTeamsLogo, href: () => null, soon: true },
]

export function ChannelRail({ orgId, activeChannel }: ChannelRailProps) {
  return (
    <aside className="w-full md:w-[200px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col">
      <div className="px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide flex-shrink-0">
        チャネル
      </div>
      <nav className="flex flex-row md:flex-col gap-1 px-2 pb-2">
        {channels.map((ch) => {
          const Icon = ch.icon
          const href = ch.href(orgId)
          const isActive = ch.key === activeChannel

          if (!href) {
            return (
              <div
                key={ch.key}
                data-testid={`channel-rail-${ch.key}`}
                aria-disabled="true"
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-gray-400 cursor-not-allowed select-none"
              >
                <Icon className="w-4 h-4" />
                <span>{ch.label}</span>
                {ch.soon && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                    近日
                  </span>
                )}
              </div>
            )
          }

          return (
            <Link
              key={ch.key}
              href={href}
              data-testid={`channel-rail-${ch.key}`}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors ${
                isActive
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" weight={isActive ? 'fill' : 'regular'} />
              <span>{ch.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
