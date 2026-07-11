'use client'

import { useMemo, useState } from 'react'
import { Plugs } from '@phosphor-icons/react'
import { EmptyState } from '@/components/shared'
import { SecretaryTabNav } from '@/components/secretary/SecretaryTabNav'
import { SinkListPane } from '@/components/secretary/integrations/SinkListPane'
import { SinkDetailPanel } from '@/components/secretary/integrations/SinkDetailPanel'
import { SecretReveal } from '@/components/secretary/integrations/SecretReveal'
import { useSinks, type SinkMeta } from '@/lib/hooks/useSinks'

interface IntegrationsConsoleClientProps {
  orgId: string
}

/**
 * 連携タブ — /{orgId}/secretary/integrations
 * Main ペイン内2カラム(左: sink一覧 / 右: 選択中sinkの設定＋配達ログ)。Inspectorは使わない。
 * モーダル禁止・保存ボタンなし(optimistic updates)。docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4。
 */
export function IntegrationsConsoleClient({ orgId }: IntegrationsConsoleClientProps) {
  const { sinks, viewerRole, notionConnection, isLoading } = useSinks(orgId)
  const [selectedSinkId, setSelectedSinkId] = useState<string | null>(null)
  const [justCreatedSecret, setJustCreatedSecret] = useState<string | null>(null)

  // 未選択時は先頭のsinkを既定にする(SecretaryConsoleClientのeffectiveSpaceIdと同じ考え方)
  const effectiveSinkId = selectedSinkId ?? sinks[0]?.id ?? null
  const selectedSink = useMemo(
    () => sinks.find((s) => s.id === effectiveSinkId) ?? null,
    [sinks, effectiveSinkId],
  )

  const handleCreated = (sink: SinkMeta, secret?: string) => {
    setSelectedSinkId(sink.id)
    // notionはsecretを持たないため、secretがある場合(webhook)だけ一度きり表示バナーを出す
    if (secret) setJustCreatedSecret(secret)
  }

  // 別sinkの選択(一覧操作)でsecretバナーを消す。作成直後のsink以外を見ている間まで
  // secretが画面に残り続けるのを防ぐ(一度きり表示の意図に合わせる)。
  const handleSelect = (sinkId: string) => {
    setSelectedSinkId(sinkId)
    setJustCreatedSecret(null)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <SecretaryTabNav orgId={orgId} activeTab="integrations" />

      {justCreatedSecret && (
        <div className="px-4 pt-3 flex-shrink-0">
          <SecretReveal secret={justCreatedSecret} onDismiss={() => setJustCreatedSecret(null)} />
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        <aside className="w-full md:w-[320px] flex-shrink-0 border-b md:border-b-0 md:border-r border-gray-200 flex flex-col max-h-64 md:max-h-none overflow-hidden">
          <SinkListPane
            orgId={orgId}
            sinks={sinks}
            selectedSinkId={effectiveSinkId}
            onSelect={handleSelect}
            viewerRole={viewerRole}
            onCreated={handleCreated}
            notionConnection={notionConnection}
          />
        </aside>

        {selectedSink ? (
          <SinkDetailPanel
            key={selectedSink.id}
            orgId={orgId}
            sink={selectedSink}
            viewerRole={viewerRole}
            notionConnection={notionConnection}
          />
        ) : (
          !isLoading && (
            <div className="flex-1 flex items-center justify-center">
              <EmptyState icon={<Plugs />} message="左の一覧から連携先を選択するか、新規作成してください" />
            </div>
          )
        )}
      </div>
    </div>
  )
}
