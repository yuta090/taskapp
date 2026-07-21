'use client'

import { integrationsByCategory, CATEGORY_LABEL, type IntegrationId } from '@/lib/integrations/registry'
import { INTEGRATION_ICONS } from '@/components/secretary/integrations/integrationIcons'

interface ToolRailProps {
  selectedId: IntegrationId
  onSelect: (id: IntegrationId) => void
}

/**
 * 「ツール連携」タブの左レール（ツール軸のサイドメニュー）。
 *
 * 表示はツールレジストリ(src/lib/integrations/registry.ts)を単一の真実の源として駆動する。
 * ChannelRail(チャネル軸)を踏襲するが、こちらはルート遷移ではなくクライアント状態選択
 * （button + onSelect）— 詳細ペインは同一ページ内でIntegrationsConsoleClientが出し分ける。
 *
 * ツール追加＝registryに1エントリ足すだけでこのレールに自動で並ぶ（配列の手編集不要）。
 * plannedのツールも選択可能（ToolConnectOverviewの「近日」詳細を出すため、遷移不可には
 * しない。ChannelRailのplannedとはここが異なる)。
 */
export function ToolRail({ selectedId, onSelect }: ToolRailProps) {
  return (
    <aside className="w-full md:w-[240px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col overflow-x-auto md:overflow-visible">
      {integrationsByCategory().map((group) => (
        <div key={group.category} className="flex-shrink-0">
          <div
            data-testid={`tool-rail-category-${group.category}`}
            className="px-4 pt-3 pb-1 text-xs font-medium text-gray-400 uppercase tracking-wide"
          >
            {CATEGORY_LABEL[group.category]}
          </div>
          <nav className="flex flex-row md:flex-col gap-1 px-2 pb-2">
            {group.items.map((def) => {
              const Icon = INTEGRATION_ICONS[def.id]
              const isSelected = def.id === selectedId

              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => onSelect(def.id)}
                  data-testid={`tool-rail-${def.id}`}
                  aria-current={isSelected ? 'page' : undefined}
                  className={`flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap text-left ${
                    isSelected
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" weight={isSelected ? 'fill' : 'regular'} />
                  <span>{def.label}</span>
                  {def.status === 'beta' && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 flex-shrink-0">
                      BETA
                    </span>
                  )}
                  {def.status === 'planned' && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">
                      近日
                    </span>
                  )}
                  {def.proOnly && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full border border-amber-300 bg-amber-100 text-amber-700 flex-shrink-0">
                      Pro
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </div>
      ))}
    </aside>
  )
}
