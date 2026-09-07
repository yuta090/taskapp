/**
 * AI秘書用 Slack アプリの設定ファイル（App Manifest）。
 *
 * 利用者に「Slack でアプリを作る」手順を1クリックにするため、AgentPM 側で manifest を組み立て、
 * Slack の「manifest から作る」画面（api.slack.com/apps?new_app=1&manifest_json=…）に渡す。
 *
 * 受信URLは「組織単位」（/api/channels/slack/webhook/org/{orgId}）を使う。account 単位URLは
 * AgentPM に鍵を登録した後にしか決まらず、利用者を Slack と AgentPM の間で往復させていたため。
 * 組織単位URLは登録前でも確定し、Slack のURL確認（url_verification）にも登録前に応答する。
 *
 * ⚠ Bot の display_name は Slack の制約で英字のみ（日本語だと username に変換できず作成が拒否される）。
 *   日本語名にしたい場合は作成後に Slack の App Home で表示名を変え、再インストールする。
 *
 * docs/slack-secretary-app-manifest.json はこの内容の写し（手貼り用・運用スクリプト用）。
 */

export const SECRETARY_SLACK_APP_NAME = 'AgentPM秘書'
export const SECRETARY_SLACK_BOT_DISPLAY_NAME = 'AgentPM Secretary'

/** 受信（会話の取り込み）と送信（合言葉の返事・完了確認）に必要な最小の bot scope */
export const SECRETARY_SLACK_BOT_SCOPES = [
  'chat:write',
  'channels:history',
  'groups:history',
  'channels:read',
  'groups:read',
] as const

export const SECRETARY_SLACK_BOT_EVENTS = ['message.channels', 'message.groups'] as const

export interface SecretarySlackManifest {
  display_information: {
    name: string
    description: string
    long_description: string
    background_color: string
  }
  features: { bot_user: { display_name: string; always_online: boolean } }
  oauth_config: { scopes: { bot: string[] } }
  settings: {
    event_subscriptions: { request_url: string; bot_events: string[] }
    org_deploy_enabled: boolean
    socket_mode_enabled: boolean
    token_rotation_enabled: boolean
  }
}

/** 組織単位の受信URL（アプリ作成前に確定できる） */
export function secretaryWebhookUrlForOrg(baseUrl: string, orgId: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/channels/slack/webhook/org/${orgId}`
}

export function buildSecretarySlackManifest(params: { eventsUrl: string }): SecretarySlackManifest {
  return {
    display_information: {
      name: SECRETARY_SLACK_APP_NAME,
      description: 'Slack のやり取りからタスクを拾い、期限や完了確認を届ける AgentPM の AI秘書',
      long_description:
        'AgentPM の AI秘書を Slack のチャンネルに同席させます。\n\n' +
        '• チャンネルの会話を読み、依頼・期限・宿題をタスクとして拾い上げます（承認してから登録）\n' +
        '• 期限が近いタスクのリマインドや「終わりましたか？」の確認をチャンネルに届けます\n' +
        '• 「完了3」のような短い返事で、タスクを Slack から閉じられます\n\n' +
        'はじめ方は AgentPM の「AI秘書 → つなぐ → Slack」の画面に沿ってください。',
      background_color: '#1B2A41',
    },
    features: {
      bot_user: { display_name: SECRETARY_SLACK_BOT_DISPLAY_NAME, always_online: true },
    },
    oauth_config: { scopes: { bot: [...SECRETARY_SLACK_BOT_SCOPES] } },
    settings: {
      event_subscriptions: { request_url: params.eventsUrl, bot_events: [...SECRETARY_SLACK_BOT_EVENTS] },
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }
}

/** Slack の「manifest からアプリを作る」画面を、設定ファイル入りで開くURL */
export function secretaryManifestCreateUrl(manifest: SecretarySlackManifest): string {
  const params = new URLSearchParams({ new_app: '1', manifest_json: JSON.stringify(manifest) })
  return `https://api.slack.com/apps?${params.toString()}`
}
