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
 *
 * ボタン操作（Interactivity / block_actions）も同じURL・同じ署名鍵で受ける。Slack は
 * application/x-www-form-urlencoded の `payload=<JSON>` で届けるため、署名検証（生ボディ）の後に
 * 形式で振り分ける。v1 で受けるのは期限リマインドの確認ボタン（[完了した][対応中][明日また確認]）
 * のみで、value は LINE の postback data と同じ形式＝同じパーサ・同じ RPC（authz は RPC 内で完結）。
 *
 * 本人紐づけ（Stage 2.7-A の Slack 版）: AgentPM で発行した TA- コードを秘書への DM
 * （channel_type='im'・message.im）に送ると、(口座, Slack user id) → 内部ユーザー の
 * channel_user_links が成立する（rpc_consume_user_link_code・LINE の 1:1 トークと同じ）。
 * チャンネルに貼られたコードは即時失効させ、合図（完了N 等）としては扱わない。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  handleClaimedGroupMessage,
  handleLimboGroupMessage,
  type TutorialWiring,
} from '@/lib/channels/groupCommands'
import type {
  CreateInstantDigestTaskInput,
  CreateInstantDigestTaskResult,
} from '@/lib/channels/store'
import {
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
} from '@/lib/channels/claimLimboCore'
import {
  parseDueReminderDonePostback,
  parseDueReminderSnoozePostback,
} from '@/lib/reminders/dueReminderPostback'
import { DUE_REMINDER_SLACK_ACTION_ID_PREFIX } from '@/lib/reminders/dueReminderMessages'
import { extractUserLinkCode, hashUserLinkCode, maskUserLinkCode } from '@/lib/channels/userLink'
import type { ConsumeUserLinkStatus } from '@/lib/channels/store'
import type { DueReminderConfirmStatus, DueReminderSnoozeStatus } from '@/lib/reminders/dueReminderStore'
import {
  DUE_REMINDER_DONE_FALLBACK_TEXT,
  DUE_REMINDER_ALREADY_DONE_TEXT,
  DUE_REMINDER_BLOCKED_TEXT,
  DUE_REMINDER_SNOOZE_CAPPED_TEXT,
  buildDueReminderDoneReplyText,
  buildDueReminderSnoozedReplyText,
} from '@/lib/reminders/dueReminderReplyTexts'

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
  /** 登録直後の練習（対話型チュートリアル）用。前からある接続を巻き込まないための日時。 */
  createdAt?: string | null
  /** 同上。練習の進み具合の置き場所（channel_groups.metadata） */
  metadata?: Record<string, unknown> | null
  /**
   * 拾い方（channel_groups.pickup_mode）。**返事で嘘をつかないためだけに使う**。
   * 'off' のグループは毎朝のまとめ配信の対象外＝「次にお届けする一覧に載ります」が果たされない。
   */
  pickupMode?: string
}

export interface SlackClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

/**
 * inbound 記録入力。claimed チャンネルでの通常発言（actor='client'・groupId あり）と、
 * ボタン押下の監査行（actor='system'・contentType='system'・groupId なし）の両方に使う。
 */
export interface SlackInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string | null
  channel: 'slack'
  direction: 'inbound'
  actor: 'client' | 'system'
  externalUserId: string | null
  externalMessageId: string | null
  contentType: 'text' | 'system'
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
  /** グループ発言への返事はそのグループ。DM/ボタンへの返事は null */
  groupId: string | null
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

export interface SlackWebhookDeps extends TutorialWiring {
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
  /**
   * ボタン押下への返事。Slack の response_url に投げる（bot token 不要・元メッセージの場所へ届く・
   * ephemeral=押した本人にだけ見える）。チャンネルへ chat.postMessage しないのは、ペイロードの
   * チャンネルを信用して社内タスク名を顧客チャンネルへ投稿する事故を構造的に防ぐため。
   */
  respondToInteraction: (responseUrl: string, text: string) => Promise<void>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** 「タスク追加 ○○」でその場に申し送りタスクを1件作る */
  createInstantDigestTask: (input: CreateInstantDigestTaskInput) => Promise<CreateInstantDigestTaskResult>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: SlackOutboundInput) => Promise<unknown>
  /**
   * 期限リマインドの確認ボタン（LINE の postback と同じ RPC）。authz（口座×外部ユーザー→内部
   * ユーザー解決・org/space束縛）は RPC が担うため、ここでは検証済みの account.id と押した人の
   * Slack user id だけを渡す。
   */
  confirmTaskDone: (
    accountId: string,
    externalUserId: string,
    taskId: string,
  ) => Promise<{ status: DueReminderConfirmStatus }>
  snoozeDueReminder: (
    accountId: string,
    externalUserId: string,
    occurrenceId: string,
    days: number,
    expectedSendCount: number,
  ) => Promise<{ status: DueReminderSnoozeStatus }>
  /** 完了の返事に載せるタスク名（ベストエフォート・取れなければ null） */
  findTaskTitle: (taskId: string) => Promise<string | null>
  /** 本人紐づけコードの消費（DM）。RPC は例外を投げず status で返す */
  consumeUserLinkCode: (
    codeHash: string,
    channelAccountId: string,
    externalUserId: string,
  ) => Promise<{ status: ConsumeUserLinkStatus; linkId: string | null }>
  /** チャンネルに晒されたコードを即時失効させる。true=失効した / false=該当なし（使用済み等） */
  expireUserLinkCode: (codeHash: string) => Promise<boolean>
}

export interface SlackAuth {
  signature: string | null
  timestamp: string | null
  /** 現在のunix秒（リプレイ判定用・テスト容易化のため注入） */
  nowSeconds: number
}

export interface WebhookResult {
  status: number
  /** null = 空ボディで返す（Interactivity の ack は「200・空」が作法。JSON はメッセージ置換と解釈されうる） */
  body: Record<string, unknown> | null
}

/** リプレイ許容窓（秒）。Slack 推奨は5分。 */
const REPLAY_WINDOW_SEC = 300

// 返信文言・完了処理・limbo償還ロジックの正本は claimLimboCore.ts（Discord/Slack/Chatwork 共通）。
// 各テストが本ファイルから直接 import しているため re-export する（ローカル重複定義はしない）。
export {
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
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
  /** 'channel' | 'group' | 'im' | 'mpim'。im=秘書への DM（本人紐づけコードの受け口） */
  channel_type?: string
  user?: string
  text?: string
  ts?: string
}

/**
 * 本人紐づけの返事（LINE の USER_LINK_REPLY と同じ粒度）。存在オラクルにならない範囲で、
 * 本人が自力で回復できる程度の情報は返す。
 */
const SLACK_USER_LINK_REPLY: Record<ConsumeUserLinkStatus, string> = {
  ok: 'Slack アカウントを連携しました。期限のリマインドや確認はこの DM に届きます。',
  invalid: 'コードが無効です。AgentPM の画面で新しいコードを発行してお試しください。',
  expired: 'コードの有効期限が切れています。AgentPM の画面で新しいコードを発行してください。',
  locked: '試行回数が多すぎます。しばらく時間をおいてからお試しください。',
  conflict:
    'この Slack アカウントは既に別のユーザーに連携されています。AgentPM の画面で連携を解除してからお試しください。',
}

/** チャンネルに誤って貼られた本人コードへの応答（コードは即時失効させる） */
const SLACK_USER_LINK_LEAKED_TEXT =
  'このコードはチャンネルでは使えません。安全のため無効化しました。AgentPM の画面で再発行し、秘書への DM（1対1）にお送りください。'

/** 失効対象が見つからなかった場合（既に使用済み・期限切れ等）。「無効化しました」と嘘をつかない */
const SLACK_USER_LINK_LEAKED_UNKNOWN_TEXT =
  'このコードはチャンネルでは使えません。秘書への DM（1対1）にお送りください。'

/** Slack の ts（秒.マイクロ秒）を ISO 文字列へ。壊れていれば epoch */
function occurredAtFromTs(ts: string): string {
  const tsSec = Number.parseFloat(ts)
  return Number.isFinite(tsSec) && tsSec > 0 ? new Date(tsSec * 1000).toISOString() : new Date(0).toISOString()
}

/**
 * 秘書への DM（channel_type='im'）。v1 は本人紐づけコード（TA-…）だけを受け、それ以外は完全沈黙。
 * 記録は必ず先に行い、本文はマスクして残す（平文コードを append-only の会話ログに入れない。
 * payload にも生イベントを入れない）。RPC は例外を投げず status で返す。
 * webhook 再送（dedupe=channel:ts）時は応答を再送しない。
 */
async function processDirectMessage(
  account: SlackAccount,
  ev: SlackEvent,
  orgId: string,
  deps: SlackWebhookDeps,
): Promise<void> {
  const code = extractUserLinkCode(ev.text)
  if (!code || typeof ev.user !== 'string') return
  const channelId = ev.channel as string

  const recorded = await deps.insertMessage({
    orgId,
    spaceId: null,
    identityId: null,
    accountId: account.id,
    groupId: null,
    channel: 'slack',
    direction: 'inbound',
    actor: 'client',
    externalUserId: ev.user,
    externalMessageId: `${channelId}:${ev.ts}`,
    contentType: 'text',
    body: maskUserLinkCode(ev.text ?? null),
    payload: { channel: channelId, channel_type: 'im', kind: 'user_link_code' },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: occurredAtFromTs(ev.ts as string),
  })

  const { status } = await deps.consumeUserLinkCode(hashUserLinkCode(code), account.id, ev.user)
  if (recorded === 'duplicate') return
  await deps.reply(account.credentials.bot_token, channelId, SLACK_USER_LINK_REPLY[status])
}

/**
 * チャンネル（claimed / limbo を問わず）に本人コードが貼られた。見た人が使えてはならないので
 * 即時失効させ、DM に送るよう案内する。合図（完了N・合言葉）としては扱わない。
 * claimed ならマスクした本文で記録する（limbo は 0 行）。
 */
async function processLeakedUserLinkCode(
  account: SlackAccount,
  ev: SlackEvent,
  code: string,
  deps: SlackWebhookDeps,
): Promise<void> {
  const channelId = ev.channel as string
  const expired = await deps.expireUserLinkCode(hashUserLinkCode(code))
  const group = await deps.findActiveGroup(account.id, channelId)
  if (group) {
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
      externalMessageId: `${channelId}:${ev.ts}`,
      contentType: 'text',
      body: maskUserLinkCode(ev.text ?? null),
      payload: { channel: channelId, kind: 'user_link_code_leaked' },
      storagePath: null,
      status: 'received',
      error: null,
      occurredAt: occurredAtFromTs(ev.ts as string),
    })
    if (recorded === 'duplicate') return
  }
  await deps.reply(
    account.credentials.bot_token,
    channelId,
    expired ? SLACK_USER_LINK_LEAKED_TEXT : SLACK_USER_LINK_LEAKED_UNKNOWN_TEXT,
  )
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
 * claimed チャンネルでの合図（完了N / ヘルプ / タスク追加）の振り分け。中身は
 * groupCommands.handleClaimedGroupMessage（7チャネル共通）。reply はテキストのみ受ける形に
 * 束縛し、chat.postMessage の ts を providerMessageId として返す。
 */
async function handleGroupCommand(
  account: SlackAccount,
  ev: SlackEvent,
  group: SlackActiveGroup,
  sourceMessageId: string,
  commandText: string,
  deps: SlackWebhookDeps,
): Promise<void> {
  const botToken = account.credentials.bot_token
  const channelId = ev.channel as string
  await handleClaimedGroupMessage(
    {
      orgId: group.orgId,
      spaceId: group.spaceId,
      accountId: account.id,
      groupId: group.id,
      channel: 'slack',
      externalUserId: ev.user ?? null,
      autoReplyTo: `${channelId}:${ev.ts}`,
      sourceMessageId,
      text: commandText,
      groupCreatedAt: group.createdAt ?? null,
      groupMetadata: group.metadata ?? null,
      // 拾い方=off のグループに「次にお届けする一覧に載ります」と嘘をつかないため
      pickupMode: group.pickupMode,
    },
    {
      completeDigestTask: deps.completeDigestTask,
      createInstantDigestTask: deps.createInstantDigestTask,
      reply: (text) =>
        deps.reply(botToken, channelId, text).then((r) => ({ providerMessageId: r.ts })),
      insertOutbound: deps.insertOutbound,
      assignDigestNumbersToNewTasks: deps.assignDigestNumbersToNewTasks,
      updateGroupMetadata: deps.updateGroupMetadata,
      now: deps.now,
    },
  )
}

async function processLimbo(
  account: SlackAccount,
  ev: SlackEvent,
  deps: SlackWebhookDeps,
): Promise<{ claimCreated: boolean }> {
  const botToken = account.credentials.bot_token
  const channelId = ev.channel as string
  const text = ev.text ?? ''

  // 登録が成立したときだけ、成立文言の後ろに練習の入り口を1通足す（応答そのものは変えない）。
  return handleLimboGroupMessage(
    { accountId: account.id, externalGroupId: channelId, text, channel: 'slack' },
    {
      normalizeClaimCode: deps.normalizeClaimCode,
      hashClaimCode: deps.hashClaimCode,
      findValidClaimCode: deps.findValidClaimCode,
      hasExternalChatChannels: deps.hasExternalChatChannels,
      externalChatGroupCapacity: deps.externalChatGroupCapacity,
      createPendingClaim: deps.createPendingClaim,
      redeemCodeOnly: deps.redeemCodeOnly,
      generateChallengeLabel: deps.generateChallengeLabel,
      registerInvalidAttempt: deps.registerInvalidAttempt,
      reply: (t) => deps.reply(botToken, channelId, t).then(() => undefined),
      findActiveGroup: deps.findActiveGroup,
      assignDigestNumbersToNewTasks: deps.assignDigestNumbersToNewTasks,
      updateGroupMetadata: deps.updateGroupMetadata,
      now: deps.now,
    },
  )
}

interface SlackBlockAction {
  action_id?: string
  value?: string
  action_ts?: string
}

interface SlackInteractionPayload {
  type?: string
  user?: { id?: string }
  channel?: { id?: string }
  container?: { channel_id?: string }
  actions?: SlackBlockAction[]
  trigger_id?: string
  /** 返事の宛先（Slack が発行・30分/5回まで有効）。無ければ返事は出さない */
  response_url?: string
}

/**
 * Slack Interactivity は `payload=<URLエンコードしたJSON>` のフォーム形式で届く。
 * route はこれで「先に ack して after() で処理」を選ぶ（3秒制約）。判定だけで本文は解釈しない。
 */
export function isSlackInteractionBody(rawBody: string): boolean {
  return rawBody.startsWith('payload=')
}

function parseInteractionPayload(rawBody: string): SlackInteractionPayload | null {
  let encoded: string | null
  try {
    encoded = new URLSearchParams(rawBody).get('payload')
  } catch {
    return null
  }
  if (!encoded) return null
  try {
    const parsed: unknown = JSON.parse(encoded)
    return parsed && typeof parsed === 'object' ? (parsed as SlackInteractionPayload) : null
  } catch {
    return null
  }
}

/**
 * 期限リマインドの確認ボタン（[完了した][対応中][明日また確認]）1押下分。
 * LINE の processDueReminderPostback と同じ順序: RPC → 沈黙すべき結果なら終了 → 監査行
 * （dedupe=channel:action_ts）→ 重複でなければ response_url へ返事 → 返事を outbound 記録。
 *
 * forbidden/not_found/already_snoozed（紐づいていない人・古いボタン）は完全沈黙（返事も
 * 監査行も残さない＝存在オラクル化とノイズ返信の両方を避ける。LINE と同方針）。
 * RPC の一過性失敗も何も残さず終える（押し直しで自然に回復する）。
 * タスク名の読み取りは RPC と並列に走らせる（Slack の3秒制約に対する往復削減）。
 */
async function processDueReminderAction(
  account: SlackAccount,
  ctx: { externalUserId: string; channelId: string; actionTs: string | null; value: string; responseUrl: string | null },
  deps: SlackWebhookDeps,
): Promise<void> {
  const doneAction = parseDueReminderDonePostback(ctx.value)
  const snoozeAction = doneAction ? null : parseDueReminderSnoozePostback(ctx.value)
  if (!doneAction && !snoozeAction) return

  const orgId = account.orgId
  if (!orgId) return

  let result: string
  let replyText: string
  let payload: Record<string, unknown>

  if (doneAction) {
    let status: DueReminderConfirmStatus
    // タスク名は返事にしか使わない（client 供給のタイトルは信頼しない・ベストエフォート）。
    // RPC と並列に読み、失敗は握って fallback 文言にする。
    const titlePromise = deps.findTaskTitle(doneAction.taskId).catch((e: unknown) => {
      console.error('Slack webhook: due reminder title lookup failed', doneAction.taskId, e)
      return null
    })
    try {
      status = (await deps.confirmTaskDone(account.id, ctx.externalUserId, doneAction.taskId)).status
    } catch (e) {
      console.error('Slack webhook: due reminder done action RPC failed', doneAction.taskId, e)
      return
    }
    if (status === 'forbidden') return
    result = status
    if (status === 'done') {
      const title = await titlePromise
      replyText = title ? buildDueReminderDoneReplyText(title) : DUE_REMINDER_DONE_FALLBACK_TEXT
    } else if (status === 'already_done') {
      replyText = DUE_REMINDER_ALREADY_DONE_TEXT
    } else {
      replyText = DUE_REMINDER_BLOCKED_TEXT
    }
    payload = { event: 'block_actions', action: 'due_reminder_done', taskId: doneAction.taskId, result }
  } else {
    const { occurrenceId, days, expectedSendCount } = snoozeAction!
    let status: DueReminderSnoozeStatus
    try {
      status = (
        await deps.snoozeDueReminder(account.id, ctx.externalUserId, occurrenceId, days, expectedSendCount)
      ).status
    } catch (e) {
      console.error('Slack webhook: due reminder snooze action RPC failed', occurrenceId, e)
      return
    }
    if (status === 'forbidden' || status === 'not_found' || status === 'already_snoozed') return
    result = status
    replyText = status === 'snoozed' ? buildDueReminderSnoozedReplyText(days) : DUE_REMINDER_SNOOZE_CAPPED_TEXT
    payload = { event: 'block_actions', action: 'due_reminder_snooze', occurrenceId, days, result }
  }

  const recorded = await deps.insertMessage({
    orgId,
    spaceId: null,
    identityId: null,
    accountId: account.id,
    groupId: null,
    channel: 'slack',
    direction: 'inbound',
    actor: 'system',
    externalUserId: ctx.externalUserId,
    externalMessageId: ctx.actionTs ? `${ctx.channelId}:action:${ctx.actionTs}` : null,
    contentType: 'system',
    body: null,
    payload,
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: new Date().toISOString(),
  })
  if (recorded === 'duplicate') return

  // 返事は response_url のみ（無ければ出さない）。チャンネルへの投稿はしない（上記 deps の説明）。
  if (!ctx.responseUrl) return
  let sent = true
  try {
    await deps.respondToInteraction(ctx.responseUrl, replyText)
  } catch (e) {
    sent = false
    console.error('Slack webhook: due reminder action respond failed', e)
  }
  await deps.insertOutbound({
    orgId,
    spaceId: null,
    accountId: account.id,
    groupId: null,
    channel: 'slack',
    direction: 'outbound',
    actor: 'secretary',
    body: replyText,
    payload: { kind: 'due_reminder_action_reply', action: payload.action, via: 'response_url' },
    status: sent ? 'sent' : 'failed',
    error: sent ? null : 'respond failed',
    occurredAt: new Date().toISOString(),
  })
}

async function handleInteraction(
  account: SlackAccount,
  rawBody: string,
  deps: SlackWebhookDeps,
): Promise<WebhookResult> {
  // Interactivity の応答は常に「200・空ボディ」。JSON を返すと元メッセージの置換と解釈されうる。
  const ack: WebhookResult = { status: 200, body: null }
  const payload = parseInteractionPayload(rawBody)
  if (!payload) return ack
  if (payload.type !== 'block_actions') return ack
  const externalUserId = payload.user?.id
  const channelId = payload.channel?.id ?? payload.container?.channel_id
  if (typeof externalUserId !== 'string' || typeof channelId !== 'string') return ack
  const responseUrl = typeof payload.response_url === 'string' ? payload.response_url : null

  for (const action of payload.actions ?? []) {
    if (typeof action.action_id !== 'string' || !action.action_id.startsWith(DUE_REMINDER_SLACK_ACTION_ID_PREFIX)) {
      continue
    }
    if (typeof action.value !== 'string') continue
    await processDueReminderAction(
      account,
      {
        externalUserId,
        channelId,
        actionTs: action.action_ts ?? payload.trigger_id ?? null,
        value: action.value,
        responseUrl,
      },
      deps,
    )
  }
  return ack
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

  // ボタン操作（Interactivity）はフォーム形式。イベント購読と同じ鍵で検証済みなのでここで振り分ける。
  if (isSlackInteractionBody(rawBody)) {
    if (account.ownerType !== 'org' || !account.orgId) {
      return { status: 400, body: { error: 'platform account not supported for slack inbound' } }
    }
    return handleInteraction(account, rawBody, deps)
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

  // 秘書への DM（1対1）は本人紐づけコードの受け口。チャンネルの合言葉・合図の流れには入れない。
  if (ev.channel_type === 'im') {
    await processDirectMessage(account, ev, account.orgId, deps)
    return { status: 200, body: { ok: true } }
  }

  // チャンネルに貼られた本人コードは、claimed/limbo の判定より先に失効させる
  // （見た人がコピーして DM に送れば本人として紐づいてしまうため）。
  const leakedCode = extractUserLinkCode(ev.text)
  if (leakedCode) {
    await processLeakedUserLinkCode(account, ev, leakedCode, deps)
    return { status: 200, body: { ok: true } }
  }

  const group = await deps.findActiveGroup(account.id, ev.channel)
  if (group) {
    const occurredAt = occurredAtFromTs(ev.ts)

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
      await handleGroupCommand(account, ev, group, recorded.id, commandText, deps)
    }
    return { status: 200, body: { ok: true } }
  }

  await processLimbo(account, ev, deps)
  return { status: 200, body: { ok: true } }
}
