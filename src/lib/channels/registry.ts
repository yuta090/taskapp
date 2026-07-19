/**
 * チャネルレジストリ — 秘書が「繋ぐ先」の単一の真実の源。
 *
 * ここ 1 箇所にチャネルのメタ情報（表示名・実装状況・能力・資格情報フィールド・
 * 受信Webhookパス・開発者コンソール手順）を集約する。以下がすべてこの定義を参照する:
 *   - 送信アダプタのディスパッチ（adapters/index.ts）
 *   - 秘書コンソールのチャネル選択UI
 *   - `channel` 値のバリデーション（DBの check 制約と同じ集合を型で持つ）
 *   - オペレーター向けセットアップ手順のHTMLドキュメント生成
 *
 * 新しいチャットを追加する = ここに 1 エントリ足して、対応する送信アダプタを 1 つ書くだけ。
 */

export type ChannelId =
  | 'line'
  | 'slack'
  | 'chatwork'
  | 'google_chat'
  | 'discord'
  | 'telegram'
  | 'teams'
  | 'whatsapp'
  | 'messenger'
  | 'email'

/** DBの channel check 制約が許容する全チャネル（migration と必ず一致させる） */
export const ALL_CHANNEL_IDS: readonly ChannelId[] = [
  'line',
  'email',
  'chatwork',
  'slack',
  'google_chat',
  'discord',
  'telegram',
  'teams',
  'whatsapp',
  'messenger',
] as const

/**
 * 実装状況。
 *  - ga:      送受信とも実装済みで本番利用可
 *  - beta:    送信は実装済み。受信/高度機能は限定的（要検証）
 *  - planned: 登録のみ。アダプタ未実装（ロードマップ）
 */
export type ChannelImplStatus = 'ga' | 'beta' | 'planned'

/** 送信/受信でオペレーターが貼り付ける資格情報のフィールド定義 */
export interface CredentialField {
  /** channel_accounts.credentials_encrypted のJSONキー */
  key: string
  label: string
  /** UIでマスク表示し、ログに出さない機微値か */
  secret: boolean
  help?: string
  /**
   * true なら値はサーバーが登録時に生成し、オペレーターは入力しない。
   * 登録レスポンスで一度だけ平文を返し、オペレーターはそれを provider 側に設定する。
   * 例: Telegram の webhook_secret（setWebhook の secret_token として貼り付ける）。
   */
  generated?: boolean
  /**
   * true なら未実装capability（主に受信Webhook）向けで、登録時は任意入力。
   * 該当capabilityが出荷されたら required に昇格する。例: chatwork.webhook_token / whatsapp.app_secret。
   */
  optional?: boolean
}

export interface ChannelDefinition {
  id: ChannelId
  /** UI表示名（厳守の用語: 「共通LINE/自社LINE」等はUI側で付与） */
  label: string
  kind: 'chat' | 'email'
  status: ChannelImplStatus
  /** 秘書がこのチャネルに送信（digest/通知/催促）できるか */
  outbound: boolean
  /** 受信Webhookで会話を channel_messages に取り込めるか */
  inbound: boolean
  /** グループ/ルーム/チャンネル宛の送信に対応するか */
  group: boolean
  /** 1:1 個別DM に対応するか（Proの line_direct_dm と同じ思想） */
  directMessage: boolean
  /** 受信Webhookの相対パス（未実装は undefined） */
  webhookPath?: string
  /** 受信署名検証の方式（オペレーターの設定に関わる） */
  signatureScheme?: 'hmac-sha256' | 'hmac-sha1' | 'ed25519' | 'bearer' | 'token' | 'none'
  /** 送信先ID（to）が何を指すかの説明（UI/doc用） */
  targetHint: string
  /** オペレーターが用意して貼り付ける資格情報 */
  credentialFields: CredentialField[]
  /** 開発者コンソールのURL（doc用） */
  setupUrl?: string
  /** 白ラベル/即時が要る等でPro専有の接続か */
  proOnly?: boolean
  /** doc/UIの補足 */
  notes?: string
}

/**
 * 主要チャットの定義。並び順 = ドキュメント/UIでの表示順（日本のB2B利用頻度に寄せる）。
 */
export const CHANNELS: Record<ChannelId, ChannelDefinition> = {
  line: {
    id: 'line',
    label: 'LINE',
    kind: 'chat',
    status: 'ga',
    outbound: true,
    inbound: true,
    group: true,
    directMessage: true,
    webhookPath: '/api/channels/line/webhook',
    signatureScheme: 'hmac-sha256',
    targetHint: 'LINE userId（Uで始まる）またはグループID（Cで始まる）',
    credentialFields: [
      { key: 'channel_secret', label: 'Channel secret', secret: true, help: 'Webhook署名検証に使用' },
      { key: 'access_token', label: 'Channel access token（長期）', secret: true, help: 'push/reply送信に使用' },
    ],
    setupUrl: 'https://developers.line.biz/console/',
    notes: '共通LINE(owner_type=platform)は無料プランの共有アカウント。自社LINE(owner_type=org・白ラベル)はPro専有。',
  },
  slack: {
    id: 'slack',
    label: 'Slack',
    kind: 'chat',
    status: 'ga',
    outbound: true,
    inbound: true,
    group: true,
    directMessage: true,
    webhookPath: '/api/slack/webhook',
    signatureScheme: 'hmac-sha256',
    targetHint: 'チャンネルID（Cで始まる）またはユーザーID（U/Wで始まる）',
    credentialFields: [
      { key: 'bot_token', label: 'Bot User OAuth Token (xoxb-)', secret: true, help: 'chat.postMessage 送信に使用' },
      { key: 'signing_secret', label: 'Signing Secret', secret: true, help: 'Events APIの署名検証に使用' },
    ],
    setupUrl: 'https://api.slack.com/apps',
    notes: '既存のSlack連携(slack_workspaces)と統合予定。scopes: chat:write, channels:read, groups:read。',
  },
  chatwork: {
    id: 'chatwork',
    label: 'Chatwork',
    kind: 'chat',
    status: 'beta',
    outbound: true,
    inbound: true,
    group: true,
    directMessage: true,
    webhookPath: '/api/channels/chatwork/webhook/{accountId}',
    signatureScheme: 'hmac-sha256',
    targetHint: 'ルームID（room_id・数字）',
    credentialFields: [
      { key: 'api_token', label: 'API Token', secret: true, help: 'X-ChatWorkToken ヘッダに使用' },
      {
        key: 'webhook_token',
        label: 'Webhook Token',
        secret: true,
        optional: true,
        help: '受信Webhook v2の署名検証（base64）。登録後に表示されるURLでChatwork側にWebhookを作成→発行されたトークンを控えて再登録で貼り付ける',
      },
    ],
    setupUrl: 'https://www.chatwork.com/service/packages/chatwork/subpackages/api/token.php',
    notes:
      '日本のSMBで普及。受信はWebhook v2（HMAC-SHA256/Base64）。account単位URLで受け、webhook_tokenで署名検証。message_created/mention_to_meのテキストを取り込む。',
  },
  google_chat: {
    id: 'google_chat',
    label: 'Google Chat',
    kind: 'chat',
    status: 'beta',
    outbound: true,
    inbound: false,
    group: true,
    directMessage: false,
    signatureScheme: 'bearer',
    targetHint: 'スペースの Incoming Webhook URL',
    credentialFields: [
      { key: 'webhook_url', label: 'Incoming Webhook URL', secret: true, help: 'スペース設定で発行したWebhook URL' },
    ],
    setupUrl: 'https://developers.google.com/chat/how-tos/webhooks',
    notes: 'Incoming Webhook方式（サービスアカウント不要）で送信。双方向はChat API + サービスアカウントが別途必要。',
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    kind: 'chat',
    status: 'beta',
    outbound: true,
    inbound: false,
    group: true,
    directMessage: false,
    signatureScheme: 'ed25519',
    targetHint: 'チャンネルの Webhook URL（またはBot利用時はチャンネルID）',
    credentialFields: [
      { key: 'webhook_url', label: 'Channel Webhook URL', secret: true, help: '各チャンネル設定→連携サービス→Webhookで発行' },
    ],
    setupUrl: 'https://discord.com/developers/applications',
    notes: 'まずはチャンネルWebhook送信。Bot(受信/署名Ed25519)は後続。',
  },
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    kind: 'chat',
    status: 'beta',
    outbound: true,
    inbound: true,
    group: true,
    directMessage: true,
    webhookPath: '/api/channels/telegram/webhook/{accountId}',
    signatureScheme: 'token',
    targetHint: 'chat_id（数値。ユーザー/グループ/チャンネル）',
    credentialFields: [
      { key: 'bot_token', label: 'Bot Token', secret: true, help: '@BotFather で発行' },
      { key: 'webhook_secret', label: 'Webhook Secret Token', secret: true, generated: true, help: '登録時にサーバーが自動生成。setWebhook の secret_token に設定する' },
    ],
    setupUrl: 'https://core.telegram.org/bots#botfather',
    notes: 'sendMessage で送信。受信は setWebhook + X-Telegram-Bot-Api-Secret-Token 照合。',
  },
  teams: {
    id: 'teams',
    label: 'Microsoft Teams',
    kind: 'chat',
    status: 'beta',
    outbound: true,
    inbound: false,
    group: true,
    directMessage: false,
    signatureScheme: 'hmac-sha256',
    targetHint: 'チャンネルの Incoming Webhook URL（Workflows/コネクタ）',
    credentialFields: [
      { key: 'webhook_url', label: 'Incoming Webhook URL', secret: true, help: 'Teamsチャンネル→ワークフロー/コネクタで発行' },
    ],
    setupUrl: 'https://learn.microsoft.com/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
    notes: 'Incoming Webhook(Adaptive Card)で送信。双方向はBot Framework + Azure登録が別途必要。',
    proOnly: true,
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp Business',
    kind: 'chat',
    status: 'beta',
    outbound: true,
    inbound: true,
    group: false,
    directMessage: true,
    webhookPath: '/api/channels/whatsapp/webhook/{accountId}',
    signatureScheme: 'hmac-sha256',
    targetHint: '送信先の電話番号（E.164形式・国番号付き）',
    credentialFields: [
      { key: 'access_token', label: 'System User Access Token', secret: true, help: 'Meta Graph API 呼び出しに使用' },
      { key: 'phone_number_id', label: 'Phone Number ID', secret: false, help: 'WhatsApp番号のID' },
      { key: 'app_secret', label: 'App Secret', secret: true, optional: true, help: 'X-Hub-Signature-256 検証（受信有効化に必要）。Meta App設定→基本設定で取得し貼付' },
      {
        key: 'verify_token',
        label: 'Webhook Verify Token',
        secret: true,
        generated: true,
        help: '登録時にサーバーが自動生成。Meta App Dashboard の Webhook 設定で「確認トークン」に貼り付ける',
      },
    ],
    setupUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    notes:
      'Meta Cloud API。ビジネス認証が必須。24時間ウィンドウ外はテンプレートのみ。受信はaccount単位URL: GET(verify_token検証)+POST(X-Hub-Signature-256をapp_secretで検証)。テキストを取り込む。',
    proOnly: true,
  },
  messenger: {
    id: 'messenger',
    label: 'Facebook Messenger',
    kind: 'chat',
    status: 'planned',
    outbound: false,
    inbound: false,
    group: false,
    directMessage: true,
    signatureScheme: 'hmac-sha256',
    targetHint: 'PSID（Page-Scoped User ID）',
    credentialFields: [
      { key: 'page_access_token', label: 'Page Access Token', secret: true },
      { key: 'app_secret', label: 'App Secret', secret: true },
    ],
    setupUrl: 'https://developers.facebook.com/docs/messenger-platform',
    notes: 'ロードマップ。Page/アプリのMetaレビューが必要。',
    proOnly: true,
  },
  email: {
    id: 'email',
    label: 'メール',
    kind: 'email',
    status: 'planned',
    outbound: false,
    inbound: false,
    group: false,
    directMessage: true,
    targetHint: 'メールアドレス',
    credentialFields: [],
    notes: 'チャネル背骨には含むが本レジストリの送信対象外（別系統）。',
  },
}

/** 表示順を保った全チャネル定義 */
export function listChannels(): ChannelDefinition[] {
  return ALL_CHANNEL_IDS.map((id) => CHANNELS[id])
}

/** チャット系（メールを除く）だけ */
export function chatChannels(): ChannelDefinition[] {
  return listChannels().filter((c) => c.kind === 'chat')
}

/** 秘書が送信できるチャネルだけ */
export function outboundChannels(): ChannelDefinition[] {
  return listChannels().filter((c) => c.outbound)
}

export function getChannel(id: string): ChannelDefinition | null {
  return isChannelId(id) ? CHANNELS[id] : null
}

export function isChannelId(value: string): value is ChannelId {
  return (ALL_CHANNEL_IDS as readonly string[]).includes(value)
}

/** そのチャネルへ実際に送信可能か（planned/outbound=false を弾く） */
export function canSendTo(id: string): boolean {
  const def = getChannel(id)
  return !!def && def.outbound
}

/**
 * オペレーターが登録時に入力する「必須」フィールド（サーバー生成・任意入力を除く）。
 * 資格情報登録APIの必須検証・UIの必須入力欄がこれを唯一の真実源にする。
 */
export function requiredCredentialFields(def: ChannelDefinition): CredentialField[] {
  return def.credentialFields.filter((f) => !f.generated && !f.optional)
}

/** サーバーが登録時に生成するフィールド（webhook_secret 等）。オペレーターは入力しない。 */
export function generatedCredentialFields(def: ChannelDefinition): CredentialField[] {
  return def.credentialFields.filter((f) => f.generated)
}
