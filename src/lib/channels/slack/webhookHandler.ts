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
 * 帰属と保存（Discord/LINE共有botと同一不変条件・§ discord/ingestHandler.ts と同じ骨格を
 * webhook単発受信向けに移植したもの。共通ヘルパ抽出はしない＝Discordを触らないための意図的な重複）:
 *   - claimed（active channel_groups がある）チャンネル → group.orgId/spaceId で
 *     insertChannelMessage（group_id 付き）。identityによる自動帰属は行わない（identityId常にnull）。
 *   - limbo（未 claim）→ 本文が claim コード正準形なら償還を試みる。コードでなければ完全沈黙
 *     （0行・無返信）。現状の「全メッセージをgroup_id無しで記録」は廃止。
 *   - コード不一致は固定文言＋レート制限（存在/理由を推測させない）。承認前は保存0行。
 *
 * Slack固有のPro ゲート（Discordと同じ思想。新規紐付けの直前のみ・既存は切らない）:
 *   external_chat_channels と maxExternalChatGroups を claim 確立直前に検査する。
 *
 * v1は owner_type='org' のみ。platform は org 解決不能なため400。
 * v1は subtype なしの通常 message のテキストのみ取り込む（bot_id/subtype/非message は無視）。
 * dedupe=channel:ts（Slackのリトライは同一 event を再送するため、tsで冪等）。
 *
 * Slack の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'

export interface SlackAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
  /** credentials.bot_user_id（登録時プローブで解決・DDLゼロ）。自分宛メンション判定に使う。未設定なら剥がさない。 */
  botUserId?: string
}

export interface SlackActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
}

export interface SlackClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

/** claimed チャンネルでの通常発言の記録入力。 */
export interface SlackInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string
  channel: 'slack'
  direction: 'inbound'
  actor: 'client'
  externalUserId: string | null
  externalMessageId: string
  contentType: 'text'
  body: string | null
  payload: Record<string, unknown>
  storagePath: null
  status: 'received'
  error: null
  occurredAt: string
}

/** 秘書の発話（完了コマンドへの応答）の outbound 記録入力。 */
export interface SlackOutboundInput {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: 'slack'
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

/** chat.postMessage の返信結果。ts は outbound記録の provider_message_id に残す。 */
export interface SlackReplyResult {
  ts: string | null
}

export interface SlackWebhookDeps {
  loadAccount: (accountId: string) => Promise<SlackAccount | null>
  findActiveGroup: (accountId: string, channelId: string) => Promise<SlackActiveGroup | null>
  insertMessage: (input: SlackInsertInput) => Promise<{ id: string } | 'duplicate'>
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (codeHash: string, accountId: string) => Promise<SlackClaimCode | null>
  hasExternalChatChannels: (orgId: string) => Promise<boolean>
  externalChatGroupCapacity: (
    orgId: string,
  ) => Promise<{ activeCount: number; max: number | null }>
  createPendingClaim: (input: {
    linkCodeId: string
    accountId: string
    externalGroupId: string
    orgId: string
    spaceId: string
    challengeLabel: string
    groupDisplayNameSnapshot: string | null
  }) => Promise<{ challengeLabel: string | null }>
  redeemCodeOnly: (
    codeHash: string,
    accountId: string,
    channelId: string,
    groupDisplayName: string | null,
    // 容量上限（RPCが同一Tx内でアトミックに強制・null=無制限）。ソフトチェックのレース対策。
    maxActiveGroups: number | null,
  ) => Promise<'linked' | 'already_linked' | 'rejected'>
  generateChallengeLabel: () => string
  registerInvalidAttempt: (accountId: string, channelId: string) => boolean
  reply: (botToken: string, channelId: string, text: string) => Promise<SlackReplyResult>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: SlackOutboundInput) => Promise<unknown>
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

// 返信文言。存在/理由/プランを推測させないため、無効系は同一文言に畳む
// （discord/ingestHandler.ts・LINE §3 と同思想）。discord/ingestHandler.ts は
// Discord固有の依存を抱えるファイルで、文言1つのために import すると channel 間に
// 不要な結合が生まれるため、ここで意図的に重複定義する（変更する場合は両方を揃える）。
export const INVALID_TEXT =
  'コードを確認できませんでした。番号が正しいか、期限切れでないかをご確認ください。'
export const CODE_ONLY_LINKED_TEXT =
  'このチャンネルを登録しました。以降のやり取りを記録します。'
export const CODE_ONLY_ALREADY_TEXT =
  'このチャンネルは既に別のコードで登録済みです。'
export function buildAcceptedText(challengeLabel: string): string {
  return (
    '受け付けました。管理画面での承認後に、このチャンネルの会話を記録します。' +
    `お問い合わせの際は確認番号「${challengeLabel}」をお伝えください。`
  )
}

export const ALREADY_DONE_TEXT = 'そのタスクは既に完了済みです。'

/** 完了コマンドで実際にタスクを完了できた場合の返信文言。 */
export function buildDigestDoneText(title: string): string {
  return `「${title}」を完了にしました。`
}

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

// Slackのユーザー/Botメンション表記(<@U…>/<@W…>)。先頭一致のみ剥がす（文中の言及は対象外）。
const SELF_MENTION_PREFIX_RE = /^<@([UW][A-Z0-9]+)>/

/**
 * 先頭が「自分（Bot）宛」のメンションのときだけ剥がす。botUserId 未設定、または
 * 他人宛メンションのときは無加工で返す（fail-safe）。
 * メンションは宛先の指定であって合図ではない — 剥がした後の文字列を厳格文法
 * （parseDigestCompleteCommand）にそのまま渡すことで誤爆を防ぐ（呼び出し側の責務）。
 */
function stripSelfMentionPrefix(content: string, botUserId: string | undefined): string {
  if (!botUserId) return content
  const match = content.match(SELF_MENTION_PREFIX_RE)
  if (!match || match[1] !== botUserId) return content
  return content.slice(match[0].length)
}

/**
 * claimed チャンネルでの「完了N」処理（discord/ingestHandler.ts の
 * handleDigestCompleteCommand と同骨格）。呼び出し元で本文は既に通常発言として記録済み
 * （監査ログ）。ここでは完了実行と返信のみ行う。
 */
async function handleDigestCompleteCommand(
  account: SlackAccount,
  ev: SlackEvent,
  group: SlackActiveGroup,
  digestNumber: number,
  deps: SlackWebhookDeps,
): Promise<void> {
  const botToken = account.credentials.bot_token
  const channelId = ev.channel as string
  const result = await deps.completeDigestTask(group.id, digestNumber, ev.user ?? null)
  const text = result ? buildDigestDoneText(result.title) : ALREADY_DONE_TEXT
  const replyResult = await deps.reply(botToken, channelId, text)
  await deps.insertOutbound({
    orgId: group.orgId,
    spaceId: group.spaceId,
    accountId: account.id,
    groupId: group.id,
    channel: 'slack',
    direction: 'outbound',
    actor: 'secretary',
    body: text,
    payload: { autoReplyTo: `${channelId}:${ev.ts}`, provider_message_id: replyResult.ts },
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
  })
}

async function processLimbo(
  account: SlackAccount,
  ev: SlackEvent,
  deps: SlackWebhookDeps,
): Promise<{ claimCreated: boolean }> {
  const botToken = account.credentials.bot_token
  const channelId = ev.channel as string
  const text = ev.text ?? ''

  // (1) 本文がコード正準形ですらない通常発言は完全沈黙（無保存・無返信）
  if (!text) return { claimCreated: false }
  const code = deps.normalizeClaimCode(text)
  if (!code) return { claimCreated: false }

  const codeHash = deps.hashClaimCode(code)
  const linkCode = await deps.findValidClaimCode(codeHash, account.id)
  if (!linkCode) {
    // (2) 見つからない/期限切れ/消費済み/対象不一致は同一文言＋レート制限
    const limited = deps.registerInvalidAttempt(account.id, channelId)
    if (!limited) await deps.reply(botToken, channelId, INVALID_TEXT)
    return { claimCreated: false }
  }

  // Slack固有Proゲート: 新規紐付けの確立直前。満たさなければ確立させず無効文言に畳む（漏らさない）。
  const entitled = await deps.hasExternalChatChannels(linkCode.orgId)
  if (!entitled) {
    await deps.reply(botToken, channelId, INVALID_TEXT)
    return { claimCreated: false }
  }
  const cap = await deps.externalChatGroupCapacity(linkCode.orgId)
  if (cap.max !== null && cap.activeCount >= cap.max) {
    await deps.reply(botToken, channelId, INVALID_TEXT)
    return { claimCreated: false }
  }

  if (linkCode.bindingMode === 'code_only') {
    // 上のソフトチェックに加え、RPC へ上限を渡して確立をアトミックに強制（並行償還のレース対策）。
    const result = await deps.redeemCodeOnly(codeHash, account.id, channelId, null, cap.max)
    const replyText =
      result === 'linked'
        ? CODE_ONLY_LINKED_TEXT
        : result === 'already_linked'
          ? CODE_ONLY_ALREADY_TEXT
          : INVALID_TEXT
    await deps.reply(botToken, channelId, replyText)
    return { claimCreated: result === 'linked' }
  }

  // web_approval: pending claim を作り確認番号を返す（実際の紐付けは管理画面の承認RPC）
  const challengeLabel = deps.generateChallengeLabel()
  const claim = await deps.createPendingClaim({
    linkCodeId: linkCode.id,
    accountId: account.id,
    externalGroupId: channelId,
    orgId: linkCode.orgId,
    spaceId: linkCode.spaceId,
    challengeLabel,
    groupDisplayNameSnapshot: null,
  })
  await deps.reply(
    botToken,
    channelId,
    buildAcceptedText(claim.challengeLabel ?? challengeLabel),
  )
  return { claimCreated: true }
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

  const group = await deps.findActiveGroup(account.id, ev.channel)
  if (group) {
    // ts は "1700000100.000200" のような秒.マイクロ秒。ミリ秒に変換。
    const tsSec = Number.parseFloat(ev.ts)
    const occurredAt =
      Number.isFinite(tsSec) && tsSec > 0
        ? new Date(tsSec * 1000).toISOString()
        : new Date(0).toISOString()

    // 「完了N」自体も通常の発言としてまず記録する（監査ログ・順序は変えない）
    const recorded = await deps.insertMessage({
      orgId: group.orgId,
      spaceId: group.spaceId,
      identityId: null,
      accountId: account.id,
      groupId: group.id,
      channel: 'slack',
      direction: 'inbound',
      actor: 'client',
      externalUserId: typeof ev.user === 'string' ? ev.user : null,
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

    if (recorded !== 'duplicate') {
      const commandText = stripSelfMentionPrefix(ev.text, account.botUserId)
      const digestNumber = parseDigestCompleteCommand(commandText)
      if (digestNumber !== null) {
        await handleDigestCompleteCommand(account, ev, group, digestNumber, deps)
      }
    }
    return { status: 200, body: { ok: true } }
  }

  await processLimbo(account, ev, deps)
  return { status: 200, body: { ok: true } }
}
