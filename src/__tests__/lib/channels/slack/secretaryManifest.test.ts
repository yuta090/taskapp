import { describe, it, expect } from 'vitest'
import {
  buildSecretarySlackManifest,
  secretaryManifestCreateUrl,
  secretaryWebhookUrlForOrg,
  SECRETARY_SLACK_BOT_SCOPES,
} from '@/lib/channels/slack/secretaryManifest'

/**
 * AI秘書用 Slack アプリの設定ファイル（manifest）は、利用者が Slack で「作る」ボタンを押すだけで
 * 済むように AgentPM 側が組み立てて渡す。受信URLは登録前でも決まる「組織単位」のURLを入れる。
 */

const ORG = '322a219f-1a73-4935-b061-08b8a5e97334'

describe('secretaryWebhookUrlForOrg', () => {
  it('組織単位の受信URLを返す（accountId に依存しない＝アプリ作成前に確定できる）', () => {
    expect(secretaryWebhookUrlForOrg('https://agentpm.app', ORG)).toBe(
      `https://agentpm.app/api/channels/slack/webhook/org/${ORG}`,
    )
  })
})

describe('buildSecretarySlackManifest', () => {
  const m = buildSecretarySlackManifest({ eventsUrl: secretaryWebhookUrlForOrg('https://agentpm.app', ORG) })

  it('アプリ名は「AgentPM秘書」、Bot 表示名は Slack の制約（英字）に従う', () => {
    expect(m.display_information.name).toBe('AgentPM秘書')
    expect(m.features.bot_user.display_name).toMatch(/^[A-Za-z0-9 _.-]+$/)
  })

  it('受信に必要な scope（送信＋公開/非公開チャンネルの読取）を持つ', () => {
    const scopes = m.oauth_config.scopes.bot
    for (const s of ['chat:write', 'channels:history', 'groups:history', 'channels:read', 'groups:read']) {
      expect(scopes).toContain(s)
    }
    expect(scopes).toEqual(SECRETARY_SLACK_BOT_SCOPES)
  })

  it('イベント購読は組織単位の受信URLとチャンネル投稿（公開/非公開）', () => {
    expect(m.settings.event_subscriptions.request_url).toBe(
      `https://agentpm.app/api/channels/slack/webhook/org/${ORG}`,
    )
    expect(m.settings.event_subscriptions.bot_events).toEqual(['message.channels', 'message.groups'])
  })
})

describe('secretaryManifestCreateUrl', () => {
  it('Slack の「manifest から作る」画面を、設定ファイル入りで開くURLを返す', () => {
    const m = buildSecretarySlackManifest({ eventsUrl: 'https://agentpm.app/x' })
    const url = new URL(secretaryManifestCreateUrl(m))
    expect(url.origin + url.pathname).toBe('https://api.slack.com/apps')
    expect(url.searchParams.get('new_app')).toBe('1')
    const json = JSON.parse(url.searchParams.get('manifest_json') ?? '{}')
    expect(json.display_information.name).toBe('AgentPM秘書')
    expect(json.settings.event_subscriptions.request_url).toBe('https://agentpm.app/x')
  })
})
