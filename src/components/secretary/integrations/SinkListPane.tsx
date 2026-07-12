'use client'

import { useState } from 'react'
import { Plus, Plugs } from '@phosphor-icons/react'
import { EmptyState } from '@/components/shared'
import type {
  SinkMeta,
  ViewerRole,
  NotionConnectionStatus,
  GoogleSheetsConnectionStatus,
} from '@/lib/hooks/useSinks'
import { CreateSinkForm } from '@/components/secretary/integrations/CreateSinkForm'
import { SinkStatusPill } from '@/components/secretary/integrations/statusPill'

interface SinkListPaneProps {
  orgId: string
  sinks: SinkMeta[]
  selectedSinkId: string | null
  onSelect: (sinkId: string) => void
  viewerRole: ViewerRole | null
  onCreated: (sink: SinkMeta, secret?: string) => void
  notionConnection?: NotionConnectionStatus
  googleSheetsConnection?: GoogleSheetsConnectionStatus
}

const PROVIDER_LABEL: Record<SinkMeta['provider'], string> = {
  webhook: 'Webhook',
  notion: 'Notion',
  google_sheets: 'Google Sheets',
}

/** 左カラム: sink一覧＋新規作成（docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4） */
export function SinkListPane({
  orgId,
  sinks,
  selectedSinkId,
  onSelect,
  viewerRole,
  onCreated,
  notionConnection,
  googleSheetsConnection,
}: SinkListPaneProps) {
  const [isCreating, setIsCreating] = useState(false)
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 py-2 flex items-center justify-between flex-shrink-0">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">連携シンク</span>
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
            notionConnection={notionConnection}
            googleSheetsConnection={googleSheetsConnection}
            onCreated={(sink, secret) => {
              setIsCreating(false)
              onCreated(sink, secret)
            }}
            onCancel={() => setIsCreating(false)}
          />
        </div>
      )}

      {sinks.length === 0 && !isCreating ? (
        <EmptyState icon={<Plugs />} message="まだ連携先がありません" />
      ) : (
        <div className="overflow-y-auto flex-1 pb-2">
          {sinks.map((sink) => {
            const isSelected = sink.id === selectedSinkId
            return (
              <div
                key={sink.id}
                role="button"
                tabIndex={0}
                data-testid={`sink-list-item-${sink.id}`}
                onClick={() => onSelect(sink.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSelect(sink.id)
                }}
                className={`mx-2 mb-1 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900 truncate flex-1">{sink.displayName}</span>
                  <SinkStatusPill status={sink.status} />
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                  <span>{PROVIDER_LABEL[sink.provider]}</span>
                  {sink.lastDelivery && (
                    <>
                      <span aria-hidden>·</span>
                      <span>直近配達: {sink.lastDelivery.status}</span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
