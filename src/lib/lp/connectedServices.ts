import { chatChannels } from '@/lib/channels/registry'
import { availableIntegrations, type IntegrationId } from '@/lib/integrations/registry'

/**
 * LP（トップページ）に「連携できているサービス」として掲載する一覧。
 *
 * 真実の源はレジストリ（src/lib/channels/registry.ts / src/lib/integrations/registry.ts）で、
 * ここは掲載用の派生ビューにすぎない。LP側で名前をハードコードすると、実装が増えても増えず・
 * 実装を落としても消えない（＝誇大表示になる）ため、必ずレジストリから引く。
 *
 * 掲載条件は「status !== 'planned'（＝実際に接続できる）」。ロードマップ止まりのツールは載せない。
 */
export interface ConnectedService {
  id: string
  label: string
}

/**
 * ツール側で掲載から外すID。「サービス名」ではなく汎用の受け口（自前で作る側）であり、
 * ロゴの列に混ぜると意味が通らないため除外する。連携できないという意味ではない。
 */
const NON_SERVICE_INTEGRATION_IDS: readonly IntegrationId[] = [
  'webhook',
  'csv_export',
  'generic_inbound',
]

/** 実装済みのチャット（LINE・Slack等）。並び順はレジストリの表示順を保つ。 */
export function connectedChatServices(): ConnectedService[] {
  return chatChannels()
    .filter((c) => c.status !== 'planned')
    .map((c) => ({ id: c.id, label: c.label }))
}

/** 実装済みのツール・データ連携（タスク管理／Notion等）。並び順はレジストリの表示順を保つ。 */
export function connectedToolServices(): ConnectedService[] {
  return availableIntegrations()
    .filter((d) => !NON_SERVICE_INTEGRATION_IDS.includes(d.id))
    .map((d) => ({ id: d.id, label: d.label }))
}
