import { describe, it, expect } from 'vitest'
import {
  connectedChatServices,
  connectedToolServices,
} from '@/lib/lp/connectedServices'
import { CHANNELS } from '@/lib/channels/registry'
import { INTEGRATIONS } from '@/lib/integrations/registry'

/**
 * LP（トップページ）に載せる「連携できているサービス」は、実装済み（status !== 'planned'）
 * だけに限る。ロードマップ止まりのツールを載せると誇大表示になるため、レジストリ由来で
 * 自動的に真になるようにし、ここで回帰として固定する。
 */
describe('connectedServices (LP掲載用の連携サービス)', () => {
  it('チャットは実装済み(planned以外)だけを載せる', () => {
    const labels = connectedChatServices().map((s) => s.label)
    expect(labels).toContain(CHANNELS.line.label)
    expect(labels).toContain(CHANNELS.slack.label)
    expect(labels).toContain(CHANNELS.teams.label)
    // planned（メール）は載せない
    expect(CHANNELS.email.status).toBe('planned')
    expect(labels).not.toContain(CHANNELS.email.label)
  })

  it('チャットはメール等の非チャットを含まない', () => {
    expect(connectedChatServices().every((s) => CHANNELS[s.id as keyof typeof CHANNELS].kind === 'chat')).toBe(true)
  })

  it('ツールは実装済み(planned以外)だけを載せる', () => {
    const labels = connectedToolServices().map((s) => s.label)
    expect(labels).toContain(INTEGRATIONS.google_tasks.label)
    expect(labels).toContain(INTEGRATIONS.notion.label)
    expect(labels).toContain(INTEGRATIONS.backlog.label)
    // planned は載せない
    for (const id of ['wrike', 'clickup', 'monday', 'freee', 'misoca', 'airtable', 'microsoft_todo'] as const) {
      expect(INTEGRATIONS[id].status).toBe('planned')
      expect(labels).not.toContain(INTEGRATIONS[id].label)
    }
  })

  it('サービス名ではない汎用の受け口（Webhook・CSV）は載せない', () => {
    const labels = connectedToolServices().map((s) => s.label)
    expect(labels).not.toContain(INTEGRATIONS.webhook.label)
    expect(labels).not.toContain(INTEGRATIONS.csv_export.label)
    expect(labels).not.toContain(INTEGRATIONS.generic_inbound.label)
  })

  it('表示順はレジストリの並び順を保つ', () => {
    const labels = connectedToolServices().map((s) => s.id)
    expect(labels.indexOf('google_tasks')).toBeLessThan(labels.indexOf('backlog'))
  })
})
