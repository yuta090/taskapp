'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { WarningCircle, PaperPlaneTilt, ArrowsClockwise } from '@phosphor-icons/react'
import { useConfirmDialog } from '@/components/shared'
import {
  useUpdateSink,
  useTestSinkDelivery,
  ALLOWED_SINK_EVENTS,
  type SinkMeta,
  type ViewerRole,
  type NotionConnectionStatus,
} from '@/lib/hooks/useSinks'
import { SinkStatusPill } from '@/components/secretary/integrations/statusPill'
import { SecretReveal } from '@/components/secretary/integrations/SecretReveal'
import { DeliveryLogList } from '@/components/secretary/integrations/DeliveryLogList'
import { WebhookReceiverGuide } from '@/components/secretary/integrations/WebhookReceiverGuide'

interface SinkDetailPanelProps {
  orgId: string
  sink: SinkMeta
  viewerRole: ViewerRole | null
  notionConnection?: NotionConnectionStatus
}

const EVENT_LABEL: Record<string, string> = {
  'task.created': '作成',
  'task.done': '完了',
  'task.dismissed': '削除/却下',
  'task.reopened': '再オープン',
}

interface TestOutcome {
  ok: boolean
  responseStatus?: number
  error?: string
}

/**
 * 右カラム: sinkの設定・有効/無効・secretローテーション・テスト配達・配達ログ。
 * 保存ボタンは持たず、フィールド操作のたびに即時mutateする(optimistic update)。
 * 親が key={sink.id} で本コンポーネントを再マウントする前提のため、
 * 選択中sink切替時のフォームstate同期はuseEffectを使わずマウント時の初期値で済ませる。
 */
export function SinkDetailPanel({ orgId, sink, viewerRole, notionConnection }: SinkDetailPanelProps) {
  const canManage = viewerRole === 'owner' || viewerRole === 'admin'
  const isNotion = sink.provider === 'notion'

  const [displayNameDraft, setDisplayNameDraft] = useState(sink.displayName)
  const [urlDraft, setUrlDraft] = useState((sink.config.url as string | undefined) ?? '')
  const [databaseIdDraft, setDatabaseIdDraft] = useState((sink.config.database_id as string | undefined) ?? '')
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<TestOutcome | null>(null)

  const updateSink = useUpdateSink()
  const testSinkDelivery = useTestSinkDelivery()
  const { confirm, ConfirmDialog } = useConfirmDialog()

  const runUpdate = async (patch: Parameters<typeof updateSink.mutateAsync>[0]) => {
    try {
      const result = await updateSink.mutateAsync(patch)
      if (result.secret) setRevealedSecret(result.secret)
      return result
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '更新に失敗しました')
      return null
    }
  }

  const handleDisplayNameBlur = () => {
    if (displayNameDraft === sink.displayName) return
    void runUpdate({ orgId, sinkId: sink.id, displayName: displayNameDraft })
  }

  const handleUrlBlur = () => {
    if (urlDraft === ((sink.config.url as string | undefined) ?? '')) return
    void runUpdate({ orgId, sinkId: sink.id, url: urlDraft })
  }

  const handleDatabaseIdBlur = () => {
    if (databaseIdDraft === ((sink.config.database_id as string | undefined) ?? '')) return
    void runUpdate({ orgId, sinkId: sink.id, config: { database_id: databaseIdDraft } })
  }

  const toggleEvent = (event: string) => {
    const next = sink.events.includes(event)
      ? sink.events.filter((e) => e !== event)
      : [...sink.events, event]
    if (next.length === 0) {
      toast.error('少なくとも1つのイベントを購読してください')
      return
    }
    void runUpdate({ orgId, sinkId: sink.id, events: next })
  }

  const handleToggleStatus = () => {
    void runUpdate({ orgId, sinkId: sink.id, status: sink.status === 'active' ? 'disabled' : 'active' })
  }

  const handleReactivate = () => {
    void runUpdate({ orgId, sinkId: sink.id, status: 'active' })
  }

  const handleRotateSecret = async () => {
    const ok = await confirm({
      title: 'secretを再生成しますか',
      message: '既存のsecretは即座に無効になります。受信側の署名検証設定も新しいsecretへ更新してください。',
      confirmLabel: '再生成する',
      variant: 'danger',
    })
    if (!ok) return
    await runUpdate({ orgId, sinkId: sink.id, rotateSecret: true })
  }

  const handleTestDelivery = async () => {
    try {
      const result = await testSinkDelivery.mutateAsync(sink.id)
      setTestResult(result.outcome as TestOutcome)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'テスト配達に失敗しました')
    }
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
      {ConfirmDialog}

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-900 truncate">{sink.displayName}</h2>
        <SinkStatusPill status={sink.status} />
      </div>

      {sink.status === 'error' && (
        <div className="rounded-lg border border-gray-100 bg-red-50 p-3 flex items-start gap-2">
          <WarningCircle className="text-red-600 text-sm flex-shrink-0 mt-0.5" weight="fill" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-red-600">
              配達エラーが続いています（連続失敗 {sink.consecutiveFailures} 回）。設定を確認してください。
            </p>
            {canManage && (
              <button
                type="button"
                onClick={handleReactivate}
                className="mt-1.5 h-7 rounded-md px-2.5 text-xs font-medium bg-white text-red-600 border border-gray-200 hover:bg-red-50 transition-colors"
              >
                再度有効化
              </button>
            )}
          </div>
        </div>
      )}

      {revealedSecret && <SecretReveal secret={revealedSecret} onDismiss={() => setRevealedSecret(null)} />}

      <div className="space-y-3">
        <div>
          <label htmlFor="sink-detail-display-name" className="block text-xs font-medium text-gray-700 mb-1">
            表示名
          </label>
          <input
            id="sink-detail-display-name"
            type="text"
            value={displayNameDraft}
            disabled={!canManage}
            onChange={(e) => setDisplayNameDraft(e.target.value)}
            onBlur={handleDisplayNameBlur}
            className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        {isNotion ? (
          <div>
            <label htmlFor="sink-detail-database-id" className="block text-xs font-medium text-gray-700 mb-1">
              データベースID
            </label>
            <input
              id="sink-detail-database-id"
              type="text"
              value={databaseIdDraft}
              disabled={!canManage}
              onChange={(e) => setDatabaseIdDraft(e.target.value)}
              onBlur={handleDatabaseIdBlur}
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
            {notionConnection && (
              <p className="mt-1 text-[11px] text-gray-500">
                {notionConnection.connected
                  ? `接続中のワークスペース: ${notionConnection.workspaceName ?? 'Notionワークスペース'}`
                  : 'Notionワークスペースが未接続です。連携先の作成画面から再接続してください。'}
              </p>
            )}
          </div>
        ) : (
          <div>
            <label htmlFor="sink-detail-url" className="block text-xs font-medium text-gray-700 mb-1">
              URL
            </label>
            <input
              id="sink-detail-url"
              type="url"
              value={urlDraft}
              disabled={!canManage}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={handleUrlBlur}
              className="w-full h-8 rounded-md border border-gray-200 px-2 text-xs disabled:bg-gray-50 disabled:text-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        )}
        <div>
          <span className="block text-xs font-medium text-gray-700 mb-1">購読イベント</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {ALLOWED_SINK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-1.5 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={sink.events.includes(event)}
                  disabled={!canManage}
                  onChange={() => toggleEvent(event)}
                  aria-label={event}
                />
                {EVENT_LABEL[event] ?? event}
              </label>
            ))}
          </div>
        </div>

        {canManage && (
          <div className="flex items-center gap-2 flex-wrap pt-1">
            {sink.status !== 'error' && (
              <button
                type="button"
                onClick={handleToggleStatus}
                className="h-7 rounded-md px-2.5 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {sink.status === 'active' ? '無効にする' : '有効にする'}
              </button>
            )}
            {!isNotion && (
              <button
                type="button"
                onClick={() => void handleRotateSecret()}
                className="h-7 rounded-md px-2.5 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                secretを再生成
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleTestDelivery()}
              disabled={testSinkDelivery.isPending}
              className="flex items-center gap-1 h-7 rounded-md px-2.5 text-xs font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              <PaperPlaneTilt className="w-3.5 h-3.5" />
              テスト配達
            </button>
          </div>
        )}

        {testResult && (
          <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.ok
              ? `テスト配達に成功しました（HTTPステータス: ${testResult.responseStatus ?? '-'}）`
              : `テスト配達に失敗しました: ${testResult.error ?? `HTTPステータス: ${testResult.responseStatus ?? '-'}`}`}
          </p>
        )}
      </div>

      <div className="pt-2 border-t border-gray-100">
        <DeliveryLogList orgId={orgId} sinkId={sink.id} canManage={canManage} />
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 pt-1">
        <ArrowsClockwise className="w-3 h-3" />
        配達は5分間隔で自動再試行されます
      </div>

      {!isNotion && <WebhookReceiverGuide />}
    </div>
  )
}
