/**
 * Slack Events API 受信のオーケストレーション（channel_accounts 系統・account単位）。
 *
 * ⚠ 既存の /api/slack/webhook（slack_workspaces / space_slack_channels を使う旧統合）とは
 *   別系統。こちらは channel_accounts（owner_type='org'・自社Slackアプリ＝白ラベル）専用で、
 *   account 単位パス /api/channels/slack/webhook/{accountId} で受け、その account の
 *   signing_secret で検証する。旧統合には一切触れない。
 *
 * 認証:
 *   - v0 署名: base文字列 `v0:{timestamp}:{rawBody}` を signing_secret で HMAC-SHA256(hex)、
 *     `v0=` 前置して X-Slack-Signature と定数時間比較。
 *   - リプレイ防止: X-Slack-Request-Timestamp が現在時刻から5分以上ずれていたら拒否。
 *   - 未検証ボディは検証成立まで一切解釈しない（url_verification の challenge も検証後のみ返す）。
 *
 * 帰属導出:
 *   - v1は owner_type='org' のみ。platform は org 解決不能なため400。
 *   - identity 突合は (org, slack, event.user) の active が1件なら space/identity 確定、0/複数は null。
 *   - v1は subtype なしの通常 message のテキストのみ取り込む（bot_id/subtype/非message は無視）。
 *   - dedupe=channel:ts（Slackのリトライは同一 event を再送するため、tsで冪等）。
 *
 * Slack の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface SlackAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
}

export interface SlackInsertInput {
  orgId: string
  spaceId: string | null
  identityId: string | null
  accountId: string
  channel: 'slack'
  direction: 'inbound'
  actor: 'client'
  externalUserId: string | null
  externalMessageId: string
  contentType: string
  body: string | null
  payload: Record<string, unknown>
  storagePath: null
  status: 'received'
  error: null
  occurredAt: string
}

export interface SlackWebhookDeps {
  loadAccount: (accountId: string) => Promise<SlackAccount | null>
  findIdentities: (
    orgId: string,
    externalId: string,
  ) => Promise<Array<{ id: string; spaceId: string }>>
  insertMessage: (input: SlackInsertInput) => Promise<{ id: string } | 'duplicate'>
}

export interface SlackAuth {
  signature: string | null
  timestamp: string | null
  /** 現在のunix秒（リプレイ判定用・テスト容易化のため注入） */
  nowSeconds: number
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

/** リプレイ許容窓（秒）。Slack 推奨は5分。 */
const REPLAY_WINDOW_SEC = 300

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

function verifySignature(
  rawBody: string,
  signingSecret: string,
  auth: SlackAuth,
): boolean {
  if (!auth.signature || !auth.timestamp) return false
  const ts = Number(auth.timestamp)
  if (!Number.isFinite(ts) || Math.abs(auth.nowSeconds - ts) > REPLAY_WINDOW_SEC) return false
  const expected =
    'v0=' + createHmac('sha256', signingSecret).update(`v0:${auth.timestamp}:${rawBody}`).digest('hex')
  return safeEqual(expected, auth.signature)
}

interface SlackEvent {
  type?: string
  subtype?: string
  bot_id?: string
  channel?: string
  user?: string
  text?: string
  ts?: string
}

export async function handleSlackWebhook(
  accountId: string,
  rawBody: string,
  auth: SlackAuth,
  deps: SlackWebhookDeps,
): Promise<WebhookResult> {
  const account = await deps.loadAccount(accountId)
  // 未知アカウント / signing_secret 未設定 / 署名・リプレイ不一致は一律401
  if (!account) return { status: 401, body: { error: 'unauthorized' } }
  const signingSecret = account.credentials.signing_secret
  if (!signingSecret || !verifySignature(rawBody, signingSecret, auth)) {
    return { status: 401, body: { error: 'unauthorized' } }
  }

  // 検証成立後にのみボディを解釈する。以降のパース/内容起因の失敗は200で握る（再送ループ回避）。
  let data: { type?: string; challenge?: string; event?: SlackEvent }
  try {
    data = JSON.parse(rawBody)
  } catch {
    return { status: 200, body: { ok: true, ignored: 'invalid json' } }
  }

  // URL検証（検証成立後にのみ challenge を返す）
  if (data.type === 'url_verification') {
    return { status: 200, body: { challenge: data.challenge ?? '' } }
  }

  // v1: org-owned のみ。platform は org 解決不能のため受けない。
  if (account.ownerType !== 'org' || !account.orgId) {
    return { status: 400, body: { error: 'platform account not supported for slack inbound' } }
  }
  const orgId = account.orgId

  if (data.type !== 'event_callback' || !data.event) {
    return { status: 200, body: { ok: true, ignored: 'non-event' } }
  }
  const ev = data.event
  // 通常のユーザーメッセージのみ。bot発言（自己ループ）・編集/削除等subtype・非messageは無視。
  if (
    ev.type !== 'message' ||
    ev.subtype ||
    ev.bot_id ||
    typeof ev.text !== 'string' ||
    !ev.channel ||
    !ev.ts
  ) {
    return { status: 200, body: { ok: true, ignored: 'unsupported event' } }
  }

  const senderId = typeof ev.user === 'string' ? ev.user : null

  let spaceId: string | null = null
  let identityId: string | null = null
  if (senderId) {
    const identities = await deps.findIdentities(orgId, senderId)
    if (identities.length === 1) {
      spaceId = identities[0].spaceId
      identityId = identities[0].id
    }
  }

  // ts は "1700000100.000200" のような秒.マイクロ秒。ミリ秒に変換。
  const tsSec = Number.parseFloat(ev.ts)
  const occurredAt = Number.isFinite(tsSec) && tsSec > 0
    ? new Date(tsSec * 1000).toISOString()
    : new Date(0).toISOString()

  await deps.insertMessage({
    orgId,
    spaceId,
    identityId,
    accountId: account.id,
    channel: 'slack',
    direction: 'inbound',
    actor: 'client',
    externalUserId: senderId,
    // dedupe: channel内で ts は一意。Slackのリトライ（同一event再送）で不変。
    externalMessageId: `${ev.channel}:${ev.ts}`,
    contentType: 'text',
    body: ev.text,
    payload: { channel: ev.channel, event: ev },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt,
  })

  return { status: 200, body: { ok: true } }
}
