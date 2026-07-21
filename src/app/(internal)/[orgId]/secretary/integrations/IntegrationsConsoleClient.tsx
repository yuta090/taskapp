'use client'

import { useState } from 'react'
import { ToolRail } from '@/components/secretary/integrations/ToolRail'
import { ConnectorSyncPane } from '@/components/secretary/integrations/ConnectorSyncPane'
import { SinkProviderPanel } from '@/components/secretary/integrations/SinkProviderPanel'
import { ToolConnectOverview } from '@/components/secretary/integrations/ToolConnectOverview'
import { SecretReveal } from '@/components/secretary/integrations/SecretReveal'
import { useSinks, type SinkMeta } from '@/lib/hooks/useSinks'
import { getIntegration, type IntegrationId } from '@/lib/integrations/registry'

interface IntegrationsConsoleClientProps {
  orgId: string
}

/**
 * ツール連携タブ — /{orgId}/secretary/integrations
 *
 * 左レール(ToolRail、ツールレジストリ駆動)＋右詳細(Main pane内、Inspectorは使わない)。
 * 右詳細はレジストリの surface で出し分ける:
 *   - connector: 双方向同期(gtasks/multica) → ConnectorSyncPane
 *   - sink:      通知連携(webhook/notion/google_sheets) → SinkProviderPanel(provider絞り込み)
 *   - export/catalog: その場書き出し・未実装(planned) → ToolConnectOverview
 *
 * モーダル禁止・保存ボタンなし(optimistic updates)。タブバー(SecretaryTabNav)は親の
 * secretary/layout.tsx が一元描画するため、ここでは自前で描画しない(二重nav禁止)。
 */
export function IntegrationsConsoleClient({ orgId }: IntegrationsConsoleClientProps) {
  const { sinks, viewerRole, notionConnection, googleSheetsConnection } = useSinks(orgId)
  const [selectedId, setSelectedId] = useState<IntegrationId>('google_tasks')
  const [justCreatedSecret, setJustCreatedSecret] = useState<string | null>(null)

  const def = getIntegration(selectedId)
  if (!def) return null

  const handleSelect = (id: IntegrationId) => {
    setSelectedId(id)
    // 別ツールの選択(一覧操作)でsecretバナーを消す。選択中のツール以外を見ている間まで
    // secretが画面に残り続けるのを防ぐ(一度きり表示の意図に合わせる)。
    setJustCreatedSecret(null)
  }

  const handleCreated = (_sink: SinkMeta, secret?: string) => {
    if (secret) setJustCreatedSecret(secret)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col md:flex-row">
      <ToolRail selectedId={selectedId} onSelect={handleSelect} />

      <div className="flex-1 min-h-0 flex flex-col">
        {justCreatedSecret && (
          <div className="px-4 pt-3 flex-shrink-0">
            <SecretReveal secret={justCreatedSecret} onDismiss={() => setJustCreatedSecret(null)} />
          </div>
        )}

        {def.surface === 'connector' && <ConnectorSyncPane orgId={orgId} />}

        {def.surface === 'sink' && (
          <SinkProviderPanel
            // sinkプロバイダ(webhook/notion/google_sheets)を切替えるたびに完全再マウントさせる。
            // keyが無いと同一インスタンスが再利用され、内部state(isCreating・selectedSinkId)や
            // 子のCreateSinkFormのuseState初期値(lockedProvider由来)が前providerのまま残ってしまう
            // (例: webhook作成フォーム入力中にnotionへ切替えてもURL欄が残存し、送信するとwebhook
            // sinkが作られる回帰バグがあった)。
            key={def.sinkProvider}
            orgId={orgId}
            provider={def.sinkProvider!}
            sinks={sinks}
            viewerRole={viewerRole}
            notionConnection={notionConnection}
            googleSheetsConnection={googleSheetsConnection}
            onCreated={handleCreated}
          />
        )}

        {(def.surface === 'export' || def.surface === 'catalog') && (
          <ToolConnectOverview def={def} />
        )}
      </div>
    </div>
  )
}
