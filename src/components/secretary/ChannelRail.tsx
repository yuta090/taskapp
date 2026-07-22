'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { chatChannels, type ChannelId } from '@/lib/channels/registry'
import { CHANNEL_ICONS } from '@/components/secretary/channelIcons'

interface ChannelRailProps {
  orgId: string
  /** 現在表示中のチャネル。未指定なら pathname から導出する。 */
  activeChannel?: ChannelId
}

/**
 * 「つなぐ」ハブの左レール（チャネル軸のサイドメニュー）。
 *
 * 表示はチャネルレジストリ(src/lib/channels/registry.ts)を単一の真実の源として駆動する。
 * チャット系チャネルを縦に並べ、実装状況で振る舞いを変える:
 *   - GA/BETA: /secretary/connect/<channel> へのリンク（LINEは既存の専用route、
 *     それ以外は汎用の [channel] セットアップページ）。beta は内部区分でありバッジは出さない。
 *   - PLANNED: 遷移不可の「近日」行（routeを持たせない）。
 *
 * チャネル追加＝registryに1エントリ足すだけでこのレールに自動で並ぶ（配列の手編集不要）。
 */
export function ChannelRail({ orgId, activeChannel }: ChannelRailProps) {
  const pathname = usePathname()
  // /{orgId}/secretary/connect/<channel>... から現在チャネルを導出
  const derived = pathname?.match(/\/secretary\/connect\/([^/]+)/)?.[1] as ChannelId | undefined
  const active = activeChannel ?? derived

  return (
    <aside className="w-full md:w-[200px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col">
      <div className="px-4 py-2 text-xs font-medium text-gray-400 uppercase tracking-wide flex-shrink-0">
        チャネル
      </div>
      <nav className="flex flex-row md:flex-col gap-1 px-2 pb-2 overflow-x-auto md:overflow-visible">
        {chatChannels().map((ch) => {
          const Icon = CHANNEL_ICONS[ch.id]
          const isActive = ch.id === active
          const planned = ch.status === 'planned'
          const href = planned ? null : `/${orgId}/secretary/connect/${ch.id}`

          if (!href) {
            return (
              <div
                key={ch.id}
                data-testid={`channel-rail-${ch.id}`}
                aria-disabled="true"
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded text-gray-400 cursor-not-allowed select-none whitespace-nowrap"
              >
                <Icon className="w-4 h-4" />
                <span>{ch.label}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">
                  近日
                </span>
              </div>
            )
          }

          return (
            <Link
              key={ch.id}
              href={href}
              data-testid={`channel-rail-${ch.id}`}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap ${
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
