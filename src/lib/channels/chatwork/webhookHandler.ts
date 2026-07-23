/**
 * Chatwork Webhook v2 受信のオーケストレーション。
 *
 * 認証設計（マルチテナント）— Telegram と同じ account 単位パス方式:
 *   - Webhookは /api/channels/chatwork/webhook/{accountId} で account を特定してから、
 *     その account の webhook_token で署名検証する（固定パスでの「どの org の秘密で検証するか」
 *     という未検証テナント推測を避ける。パスが account を確定させる）。
 *   - Chatwork の webhook_token は base64 で配布される。署名は
 *     base64( HMAC-SHA256( rawBody, base64decode(webhook_token) ) ) を
 *     X-ChatWorkWebhookSignature ヘッダで送ってくる。生ボディに対し定数時間比較で照合する。
 *   - 未検証ボディは検証成立まで一切解釈しない（不一致/未知/秘密未設定は401・何も書かない）。
 *
 * 帰属と保存（Slack/Discord共有botと同一不変条件・§ slack/webhookHandler.ts と同じ骨格を
 * Chatwork向けに移植したもの。共通ヘルパ抽出はしない＝他チャネルを触らないための意図的な重複）:
 *   - claimed（active channel_groups がある）ルーム → group.orgId/spaceId で
 *     insertMessage（group_id 付き）。identityによる自動帰属は行わない（identityId常にnull）。
 *   - limbo（未 claim）→ 本文が claim コード正準形なら償還を試みる。コードでなければ完全沈黙
 *     （0行・無返信）。旧「全メッセージをgroup_id無しで記録」は廃止。
 *   - コード不一致は固定文言＋レート制限（存在/理由を推測させない）。承認前は保存0行。
 *
 * Chatwork固有のPro ゲート（Slack/Discordと同じ思想。新規紐付けの直前のみ・既存は切らない）:
 *   external_chat_channels と maxExternalChatGroups を claim 確立直前に検査する。
 *
 * v1は owner_type='org' のみ。platform は org 解決不能なため400。
 * v1は message_created / mention_to_me のテキストのみ取り込む（それ以外は無視）。
 * dedupe=room_id:message_id（room内で message_id は一意・webhook再送で不変）。
 *
 * Chatwork の再送を避けるため、署名不一致(401)/platform(400) 以外は常に200を返す。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'

export interface ChatworkAccount {
  id: string
  channel: string
  orgId: string | null
  ownerType: 'org' | 'platform'
  status: 'active' | 'disabled'
  credentials: Record<string, string>
  /**
   * credentials.bot_account_id（自社Botの Chatwork account_id）。self-loop判定と、
   * 自分宛メンション([To:aid]/[rp aid=...])判定の両方に使う。未設定ならself-loop判定は
   * スキップし、メンション判定は無加工にフォールバックする（fail-safe）。
   */
  botAccountId?: string
}

export interface ChatworkActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
}

export interface ChatworkClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

/** claimed ルームでの通常発言の記録入力。 */
export interface ChatworkInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string
  channel: 'chatwork'
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
export interface ChatworkOutboundInput {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: 'chatwork'
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

/** ルームへのメッセージ送信結果。message_id は outbound記録の provider_message_id に残す。 */
export interface ChatworkReplyResult {
  messageId: string | null
}

export interface ChatworkWebhookDeps {
  loadAccount: (accountId: string) => Promise<ChatworkAccount | null>
  findActiveGroup: (accountId: string, roomId: string) => Promise<ChatworkActiveGroup | null>
  insertMessage: (input: ChatworkInsertInput) => Promise<{ id: string } | 'duplicate'>
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (codeHash: string, accountId: string) => Promise<ChatworkClaimCode | null>
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
    roomId: string,
    groupDisplayName: string | null,
    // 容量上限（RPCが同一Tx内でアトミックに強制・null=無制限）。ソフトチェックのレース対策。
    maxActiveGroups: number | null,
  ) => Promise<'linked' | 'already_linked' | 'rejected'>
  generateChallengeLabel: () => string
  registerInvalidAttempt: (accountId: string, roomId: string) => boolean
  reply: (apiToken: string, roomId: string, text: string) => Promise<ChatworkReplyResult>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: ChatworkOutboundInput) => Promise<unknown>
}

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

// 返信文言。存在/理由/プランを推測させないため、無効系は同一文言に畳む
// （slack/webhookHandler.ts・discord/ingestHandler.ts・LINE §3 と同思想）。文言1つのために
// import すると channel 間に不要な結合が生まれるため、ここで意図的に重複定義する
// （変更する場合は全チャネルを揃える）。
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

/** Chatwork Webhook v2 署名（base64(HMAC-SHA256(rawBody, base64decode(token)))）の検証 */
function verifySignature(rawBody: string, webhookTokenB64: string, header: string): boolean {
  let key: Buffer
  try {
    key = Buffer.from(webhookTokenB64, 'base64')
  } catch {
    return false
  }
  if (key.length === 0) return false
  const expected = createHmac('sha256', key).update(rawBody, 'utf8').digest('base64')
  return safeEqual(expected, header)
}

/** message を伴うイベント型のみ取り込む（それ以外は無視） */
const MESSAGE_EVENT_TYPES = new Set(['message_created', 'mention_to_me'])

interface CwEvent {
  message_id?: string | number
  room_id?: string | number
  account_id?: string | number
  body?: string
  send_time?: number
}

// Chatworkの自分宛メンション表記。[To:aid] は先頭固定、[rp aid=... to=...] は返信マークアップ。
// いずれも先頭一致のみ剥がす（文中の言及は対象外）。
const CHATWORK_TO_MENTION_RE = /^\[To:(\d+)\]/
const CHATWORK_REPLY_MENTION_RE = /^\[rp aid=(\d+) to=[^\]]*\]/

/**
 * 先頭が「自分（Bot）宛」の [To:accountId] または [rp aid=accountId to=...] トークンのときだけ
 * 剥がす。botAccountId 未設定、または他人宛のときは無加工で返す（fail-safe）。
 *
 * ⚠ Chatwork のクライアントUIは [To:aid] トークンの直後に相手の表示名を素テキストで挿入する
 * ことがある（例: "[To:1234]山田さん\n完了3"）。表示名までは剥がさないため、その場合は剥がした
 * 後の文字列が parseDigestCompleteCommand の厳格文法（"完了N"のみ）に一致せず、メンション付きの
 * 完了コマンドは発火しない。メンションは宛先の指定であって合図ではない — この非対称は許容する
 * （メンション無しの素の「完了N」は常に発火する）。
 */
function stripChatworkSelfMention(content: string, botAccountId: string | undefined): string {
  if (!botAccountId) return content
  const replyMatch = content.match(CHATWORK_REPLY_MENTION_RE)
  if (replyMatch) {
    return replyMatch[1] === botAccountId ? content.slice(replyMatch[0].length) : content
  }
  const toMatch = content.match(CHATWORK_TO_MENTION_RE)
  if (toMatch) {
    return toMatch[1] === botAccountId ? content.slice(toMatch[0].length) : content
  }
  return content
}

/**
 * claimed ルームでの「完了N」処理（slack/webhookHandler.ts の
 * handleDigestCompleteCommand と同骨格）。呼び出し元で本文は既に通常発言として記録済み
 * （監査ログ）。ここでは完了実行と返信のみ行う。
 */
async function handleDigestCompleteCommand(
  account: ChatworkAccount,
  roomId: string,
  senderId: string | null,
  autoReplyTo: string,
  group: ChatworkActiveGroup,
  digestNumber: number,
  deps: ChatworkWebhookDeps,
): Promise<void> {
  const apiToken = account.credentials.api_token
  const result = await deps.completeDigestTask(group.id, digestNumber, senderId)
  const text = result ? buildDigestDoneText(result.title) : ALREADY_DONE_TEXT
  const replyResult = await deps.reply(apiToken, roomId, text)
  await deps.insertOutbound({
    orgId: group.orgId,
    spaceId: group.spaceId,
    accountId: account.id,
    groupId: group.id,
    channel: 'chatwork',
    direction: 'outbound',
    actor: 'secretary',
    body: text,
    payload: { autoReplyTo, provider_message_id: replyResult.messageId },
    status: 'sent',
    error: null,
    occurredAt: new Date().toISOString(),
  })
}

async function processLimbo(
  account: ChatworkAccount,
  roomId: string,
  body: string | null,
  deps: ChatworkWebhookDeps,
): Promise<{ claimCreated: boolean }> {
  const apiToken = account.credentials.api_token
  const text = body ?? ''

  // (1) 本文がコード正準形ですらない通常発言は完全沈黙（無保存・無返信）
  if (!text) return { claimCreated: false }
  const code = deps.normalizeClaimCode(text)
  if (!code) return { claimCreated: false }

  const codeHash = deps.hashClaimCode(code)
  const linkCode = await deps.findValidClaimCode(codeHash, account.id)
  if (!linkCode) {
    // (2) 見つからない/期限切れ/消費済み/対象不一致は同一文言＋レート制限
    const limited = deps.registerInvalidAttempt(account.id, roomId)
    if (!limited) await deps.reply(apiToken, roomId, INVALID_TEXT)
    return { claimCreated: false }
  }

  // Chatwork固有Proゲート: 新規紐付けの確立直前。満たさなければ確立させず無効文言に畳む（漏らさない）。
  const entitled = await deps.hasExternalChatChannels(linkCode.orgId)
  if (!entitled) {
    await deps.reply(apiToken, roomId, INVALID_TEXT)
    return { claimCreated: false }
  }
  const cap = await deps.externalChatGroupCapacity(linkCode.orgId)
  if (cap.max !== null && cap.activeCount >= cap.max) {
    await deps.reply(apiToken, roomId, INVALID_TEXT)
    return { claimCreated: false }
  }

  if (linkCode.bindingMode === 'code_only') {
    // 上のソフトチェックに加え、RPC へ上限を渡して確立をアトミックに強制（並行償還のレース対策）。
    const result = await deps.redeemCodeOnly(codeHash, account.id, roomId, null, cap.max)
    const replyText =
      result === 'linked'
        ? CODE_ONLY_LINKED_TEXT
        : result === 'already_linked'
          ? CODE_ONLY_ALREADY_TEXT
          : INVALID_TEXT
    await deps.reply(apiToken, roomId, replyText)
    return { claimCreated: result === 'linked' }
  }

  // web_approval: pending claim を作り確認番号を返す（実際の紐付けは管理画面の承認RPC）
  const challengeLabel = deps.generateChallengeLabel()
  const claim = await deps.createPendingClaim({
    linkCodeId: linkCode.id,
    accountId: account.id,
    externalGroupId: roomId,
    orgId: linkCode.orgId,
    spaceId: linkCode.spaceId,
    challengeLabel,
    groupDisplayNameSnapshot: null,
  })
  await deps.reply(apiToken, roomId, buildAcceptedText(claim.challengeLabel ?? challengeLabel))
  return { claimCreated: true }
}

export async function handleChatworkWebhook(
  accountId: string,
  rawBody: string,
  signatureHeader: string | null,
  deps: ChatworkWebhookDeps,
): Promise<WebhookResult> {
  const account = await deps.loadAccount(accountId)
  // 未知アカウント / webhook_token 未設定 / 署名不一致は一律401（存在秘匿・何も書かない）
  if (!account) return { status: 401, body: { error: 'unauthorized' } }
  const token = account.credentials.webhook_token
  if (!token || !signatureHeader || !verifySignature(rawBody, token, signatureHeader)) {
    return { status: 401, body: { error: 'unauthorized' } }
  }

  // v1: org-owned のみ。platform は org 解決不能のため受けない。
  if (account.ownerType !== 'org' || !account.orgId) {
    return { status: 400, body: { error: 'platform account not supported for chatwork inbound' } }
  }

  // 検証成立後にのみボディを解釈する。以降のパース/内容起因の失敗は200で握る（再送ループ回避）。
  let payload: { webhook_event_type?: string; webhook_event?: CwEvent }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { status: 200, body: { ok: true, ignored: 'invalid json' } }
  }

  const eventType = payload.webhook_event_type
  const ev = payload.webhook_event
  if (!eventType || !MESSAGE_EVENT_TYPES.has(eventType) || !ev) {
    // message_updated / message_deleted / room_* 等はv1では無視（テキスト取り込みに限定）
    return { status: 200, body: { ok: true, ignored: 'unsupported event' } }
  }
  if (typeof ev.body !== 'string' || ev.message_id == null || ev.room_id == null) {
    return { status: 200, body: { ok: true, ignored: 'incomplete event' } }
  }

  const senderId = ev.account_id != null ? String(ev.account_id) : null

  // 自社Bot自身の発言をループ取り込みしない（bot_account_id を控えている場合のみ判定）。
  // 送信は別途 direction='outbound' で記録済みのため、これを inbound=client として二重記録しない。
  const botAccountId = account.botAccountId
  if (botAccountId && senderId && botAccountId === senderId) {
    return { status: 200, body: { ok: true, ignored: 'self message' } }
  }

  const roomId = String(ev.room_id)
  const occurredAt = ev.send_time
    ? new Date(ev.send_time * 1000).toISOString()
    : new Date(0).toISOString()

  const group = await deps.findActiveGroup(account.id, roomId)
  if (group) {
    // 「完了N」自体も通常の発言としてまず記録する（監査ログ・順序は変えない）
    const recorded = await deps.insertMessage({
      orgId: group.orgId,
      spaceId: group.spaceId,
      identityId: null,
      accountId: account.id,
      groupId: group.id,
      channel: 'chatwork',
      direction: 'inbound',
      actor: 'client',
      externalUserId: senderId,
      // dedupe: room内で message_id は一意。webhook再送で変わらない。
      externalMessageId: `${roomId}:${ev.message_id}`,
      contentType: 'text',
      body: ev.body,
      payload: { room_id: roomId, event: ev, event_type: eventType },
      storagePath: null,
      status: 'received',
      error: null,
      occurredAt,
    })

    if (recorded !== 'duplicate') {
      const commandText = stripChatworkSelfMention(ev.body, botAccountId)
      const digestNumber = parseDigestCompleteCommand(commandText)
      if (digestNumber !== null) {
        await handleDigestCompleteCommand(
          account,
          roomId,
          senderId,
          `${roomId}:${ev.message_id}`,
          group,
          digestNumber,
          deps,
        )
      }
    }
    return { status: 200, body: { ok: true } }
  }

  await processLimbo(account, roomId, ev.body, deps)
  return { status: 200, body: { ok: true } }
}
