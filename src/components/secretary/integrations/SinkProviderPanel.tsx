'use client'

import { useMemo, useState } from 'react'
import { Plus, Plugs } from '@phosphor-icons/react'
import { EmptyState } from '@/components/shared'
import type {
  SinkMeta,
  SinkProvider,
  ViewerRole,
  NotionConnectionStatus,
  GoogleSheetsConnectionStatus,
} from '@/lib/hooks/useSinks'
import { CreateSinkForm } from '@/components/secretary/integrations/CreateSinkForm'
import { SinkDetailPanel } from '@/components/secretary/integrations/SinkDetailPanel'
import { SinkStatusPill } from '@/components/secretary/integrations/statusPill'

interface SinkProviderPanelProps {
  orgId: string
  provider: SinkProvider
  sinks: SinkMeta[]
  viewerRole: ViewerRole | null
  notionConnection?: NotionConnectionStatus
  googleSheetsConnection?: GoogleSheetsConnectionStatus
  onCreated: (sink: SinkMeta, secret?: string) => void
}

/**
 * ToolRailでsinkProvider(webhook/notion/google_sheets)が選択された際の詳細ペイン。
 * 1プロバイダ分の「一覧＋新規作成＋詳細」を合成する(旧SinkListPane+SinkDetailPanelの
 * 2カラムをprovider単位に絞り込んだ形)。モーダル禁止・保存ボタンなし(optimistic)。
 */
export function SinkProviderPanel({
  orgId,
  provider,
  sinks,
  viewerRole,
  notionConnection,
  googleSheetsConnection,
  onCreated,
}: SinkProviderPanelProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [selectedSinkId, setSelectedSinkId] = useState<string | null>(null)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'

  const providerSinks = useMemo(() => sinks.filter((s) => s.provider === provider), [sinks, provider])
  const effectiveSinkId = selectedSinkId ?? providerSinks[0]?.id ?? null
  const selectedSink = useMemo(
    () => providerSinks.find((s) => s.id === effectiveSinkId) ?? null,
    [providerSinks, effectiveSinkId],
  )

  const handleCreated = (sink: SinkMeta, secret?: string) => {
    setIsCreating(false)
    setSelectedSinkId(sink.id)
    onCreated(sink, secret)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <aside className="w-full md:w-[280px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col max-h-64 md:max-h-none overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-shrink-0">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">連携先</span>
          {canManage && !isCreating && (
            <button
              type="button"
              onClick={() => setIsCreating(true)}
              className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              新規作成
            </button>
          )}
        </div>

        {isCreating && (
          <div className="px-3 pb-3 flex-shrink-0">
            <CreateSinkForm
              orgId={orgId}
              lockedProvider={provider}
              notionConnection={notionConnection}
              googleSheetsConnection={googleSheetsConnection}
              onCreated={handleCreated}
              onCancel={() => setIsCreating(false)}
            />
          </div>
        )}

        {providerSinks.length === 0 && !isCreating ? (
          <EmptyState icon={<Plugs />} message="まだ連携先がありません" />
        ) : (
          <div className="overflow-y-auto flex-1 pb-2">
            {providerSinks.map((sink) => {
              const isSelected = sink.id === effectiveSinkId
              return (
                <div
                  key={sink.id}
                  role="button"
                  tabIndex={0}
                  data-testid={`sink-provider-item-${sink.id}`}
                  onClick={() => setSelectedSinkId(sink.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setSelectedSinkId(sink.id)
                  }}
                  className={`mx-2 mb-1 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 truncate flex-1">{sink.displayName}</span>
                    <SinkStatusPill status={sink.status} />
                  </div>
                  {sink.lastDelivery && (
                    <div className="mt-0.5 text-[11px] text-gray-400">直近配達: {sink.lastDelivery.status}</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </aside>

      {selectedSink ? (
        <SinkDetailPanel
          key={selectedSink.id}
          orgId={orgId}
          sink={selectedSink}
          viewerRole={viewerRole}
          notionConnection={notionConnection}
          googleSheetsConnection={googleSheetsConnection}
        />
      ) : (
        !isCreating && (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState icon={<Plugs />} message="左の一覧から連携先を選択するか、新規作成してください" />
          </div>
        )
      )}
    </div>
  )
}
