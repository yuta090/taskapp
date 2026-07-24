/**
 * Microsoft Teams（Bot Framework）messaging endpoint 受信のオーケストレーション。
 *
 * PR-1: 未 claim グループでの合言葉償還（claim bootstrap）を成立させた。
 * PR-2（本ファイル）: claimed グループの通常発言取り込み＋「完了N」を成立させる
 * （Telegram(telegram/webhookHandler.ts)の claimed 分岐と同じ骨格。共通ヘルパ抽出はしない＝
 * 既存チャネルを触らないための意図的な重複）。
 *   - claimed（active channel_groups がある）→ まず通常発言として insertMessage（group_id
 *     付き・identityId常にnull・dedupe=`${channelId}:${activityId}`）。記録が duplicate なら
 *     以降の metadata 反映・完了処理は一切しない（Bot Framework 再送で二重完了・無駄な
 *     select+updateを避けるため・PR-2レビュー是正）。
 *   - 記録が新規なら、続けて serviceUrl/teamId/tenantId を group.metadata へ best-effort で
 *     反映する（PR-3 の能動送信（adapters/teams.ts の platform proactive 経路）が
 *     metadata.serviceUrl を読む。失敗しても記録・沈黙は壊さない）。
 *   - 記録が新規なら、mention除去後テキスト（activity.text。stripTeamsMentionはactivity.ts側で
 *     適用済み）を parseDigestCompleteCommand にかけ、マッチすれば runDigestCompletion で
 *     申し送りタスクを完了→返信→outbound記録する。
 *   - limbo（未claim）→ 本文が claim コード正準形なら償還を試みる（claimLimboCore.ts・変更なし）。
 *     code_only 償還が成立した場合はグループがこの呼び出しの中で即 active 化されるため、
 *     償還メッセージ自身の activity（serviceUrl 等を持つ）を使って metadata へ即反映する
 *     （PR-3 是正・Medium: 反映しないと「claim済みだが一度も発言が無い静かなグループ」への
 *     能動送信が初回発言まで無期限に届かない＝拾い漏れゼロの約束に反する穴だった）。
 *     web_approval（pending作成のみ）はこの時点でグループがまだ active 化されないため対象外
 *     （承認後の初回発言で recordGroupMetadata が反映する・従来どおり）。
 *
 * v1 は platform account のみ対応（google-chat 同型。owner_type='platform'・channel='teams' の
 * 共通行を deps.loadPlatformAccount で引く。単一の messaging endpoint が全 org 共有）。
 *
 * 自Bot/他Bot（activity.from.id が 28: prefix）の発言は多層防御のため無視する
 * （Telegram の from.is_bot / Discord の author.bot と同じ思想）。
 *
 * reply は Teams 側の都合（Connector REST への非同期POST）をルート側（route.ts）で束ねた
 * クロージャとして受け取る「テキストのみ」の形（processClaimLimbo の reply 契約と同型）。
 *
 * 文言・分岐順序の正本は claimLimboCore.ts（Discord/Slack/Chatwork/Telegram/Google Chat/Teams
 * 共通）。ここは re-export のみ行う（ローカル重複定義はしない）。
 */
import { parseDigestCompleteCommand } from '@/lib/channels/digest/commands'
import {
  processClaimLimbo,
  runDigestCompletion,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
} from '@/lib/channels/claimLimboCore'
import type { NormalizedTeamsActivity } from '@/lib/channels/teams/activity'

export interface TeamsPlatformAccount {
  id: string
}

export interface TeamsActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
}

export interface TeamsClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

/** claimed グループでの通常発言の記録入力。 */
export interface TeamsInsertInput {
  orgId: string
  spaceId: string | null
  identityId: null
  accountId: string
  groupId: string
  channel: 'teams'
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
export interface TeamsOutboundInput {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: 'teams'
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent' | 'failed'
  error: string | null
  occurredAt: string
}

/** channel_groups.metadata へ反映する Teams 固有の付帯情報（値が取れた項目のみ渡す）。 */
export interface TeamsGroupMetadataPatch {
  serviceUrl?: string
  teamId?: string
  tenantId?: string
}

export interface TeamsWebhookDeps {
  loadPlatformAccount: () => Promise<TeamsPlatformAccount | null>
  findActiveGroup: (accountId: string, channelId: string) => Promise<TeamsActiveGroup | null>
  /** claimedグループの通常発言を記録する（group_id付き）。dedupeは`${channelId}:${activityId}`。 */
  insertMessage: (input: TeamsInsertInput) => Promise<{ id: string } | 'duplicate'>
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: TeamsOutboundInput) => Promise<unknown>
  /**
   * serviceUrl/teamId/tenantId を group.metadata へ反映する（PR-3の能動送信が使う）。
   * best-effort — 失敗しても記録・完了処理は継続する（呼び出し側でcatchする）。
   */
  updateGroupMetadata: (groupId: string, patch: TeamsGroupMetadataPatch) => Promise<void>
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (codeHash: string, accountId: string) => Promise<TeamsClaimCode | null>
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
  /** Connector経由の返信。serviceUrl/conversationIdはroute側で束縛済み・テキストのみ受ける。 */
  reply: (text: string) => Promise<void>
}

// 返信文言・完了処理・limbo償還ロジックの正本は claimLimboCore.ts。テストが本ファイルから直接
// import できるよう re-export する（ローカル重複定義はしない）。
export {
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
  ALREADY_DONE_TEXT,
  buildDigestDoneText,
}

/**
 * serviceUrl/teamId/tenantId を group.metadata へ反映する（best-effort）。
 * 値が normalized から取れない項目はキーごとスキップする。全項目取れなければ何もしない
 * （既存 metadata を空更新で壊さないため）。失敗は握りつぶし記録・完了処理は継続する。
 */
async function recordGroupMetadata(
  groupId: string,
  activity: NormalizedTeamsActivity,
  deps: TeamsWebhookDeps,
): Promise<void> {
  const patch: TeamsGroupMetadataPatch = {}
  // trim揃え（Lowレビュー是正）: jwtVerify.tsのSSRF突合（claimed/providedとも比較前にtrimのみ
  // 行う）と正本を揃える。Teamsは実際には空白付きserviceUrlを送らないため実害は無いが、
  // 保存経路と検証経路の正規化ルールを一致させておく。
  if (activity.serviceUrl) patch.serviceUrl = activity.serviceUrl.trim()
  if (activity.teamId) patch.teamId = activity.teamId
  if (activity.tenantId) patch.tenantId = activity.tenantId
  if (Object.keys(patch).length === 0) return

  try {
    await deps.updateGroupMetadata(groupId, patch)
  } catch (error) {
    console.error('teams webhook: updateGroupMetadata failed', error)
  }
}

/**
 * claimed グループでの通常発言取り込み＋「完了N」処理（PR-2）。
 * 順序: ①まず通常発言として記録 → ②記録が新規なら metadata反映(best-effort) → ③完了コマンド判定。
 * duplicate（webhook再送）は②③とも行わない（PR-2レビュー是正: 再送のたびの無駄な
 * select+updateを避ける。metadataの中身は同一グループなら毎回同じ値が再送されるため実害も無い）。
 */
async function handleClaimedGroup(
  account: TeamsPlatformAccount,
  group: TeamsActiveGroup,
  activity: NormalizedTeamsActivity,
  deps: TeamsWebhookDeps,
): Promise<void> {
  const recorded = await deps.insertMessage({
    orgId: group.orgId,
    spaceId: group.spaceId,
    identityId: null,
    accountId: account.id,
    groupId: group.id,
    channel: 'teams',
    direction: 'inbound',
    actor: 'client',
    externalUserId: activity.externalUserId,
    // dedupe: 同一チャネル内でactivity.idは一意。Bot Framework再送で変わらない。
    externalMessageId: `${activity.externalGroupId}:${activity.activityId}`,
    contentType: 'text',
    body: activity.text,
    payload: { channelId: activity.externalGroupId, activity },
    storagePath: null,
    status: 'received',
    error: null,
    occurredAt: activity.occurredAt,
  })

  if (recorded === 'duplicate') return

  await recordGroupMetadata(group.id, activity, deps)

  if (activity.text === null) return

  // メンションは宛先の指定であって合図ではない。剥がした後の文字列（activity.text。除去は
  // activity.ts の normalizeTeamsActivity が済ませている）を厳格文法にそのまま渡すことで
  // 誤爆を防ぐ（Telegram の stripSelfMention と同思想）。
  const digestNumber = parseDigestCompleteCommand(activity.text)
  if (digestNumber === null) return

  await runDigestCompletion(
    {
      orgId: group.orgId,
      spaceId: group.spaceId,
      accountId: account.id,
      groupId: group.id,
      channel: 'teams',
      externalUserId: activity.externalUserId,
      autoReplyTo: `${activity.externalGroupId}:${activity.activityId}`,
    },
    digestNumber,
    {
      completeDigestTask: deps.completeDigestTask,
      reply: (text) => deps.reply(text).then(() => ({ providerMessageId: null })),
      insertOutbound: deps.insertOutbound,
    },
  )
}

/**
 * Bot Framework activity（正規化済み）を処理する。JWT検証・活動の正規化はroute側の責務。
 *
 * 例外は投げない設計にはしていない（route側がtry/catchで500に変換する。Bot Frameworkの
 * 再送は許容してよい＝claimed/limbo判定前に落ちるのは配線ミス級のバグであり、200で握り
 * つぶすとサイレント欠落になるため。google-chat/webhookHandler.tsと同じ方針）。
 */
export async function handleTeamsWebhook(
  activity: NormalizedTeamsActivity,
  deps: TeamsWebhookDeps,
): Promise<void> {
  // 自Bot・他Botの多層防御。webhookの発信元は自Botではあり得ないが、グループ内の他Botの
  // 発言まで拾ってしまうのを防ぐ（Telegram/Discordと同じ骨格）。
  if (activity.isBot) return

  const account = await deps.loadPlatformAccount()
  if (!account) return

  const group = await deps.findActiveGroup(account.id, activity.externalGroupId)
  if (group) {
    await handleClaimedGroup(account, group, activity, deps)
    return
  }

  const limboResult = await processClaimLimbo(
    { accountId: account.id, externalGroupId: activity.externalGroupId, text: activity.text },
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
      reply: deps.reply,
    },
  )

  await backfillServiceUrlAfterClaim(account, activity, limboResult, deps)
}

/**
 * code_only 償還直後の serviceUrl 即時反映（PR-3 是正・Medium）。
 *
 * claimLimboCore.ts の processClaimLimbo は claimCreated:true を code_only(linked) と
 * web_approval(pending作成) の両方で返すため、戻り値だけでは判別できない
 * （claimLimboCore.ts は変更しない方針＝teamsローカルで判別する）。そこで claimCreated:true の
 * ときだけ findActiveGroup を再クエリし、直前まで limbo（null）だったグループが今 active に
 * なっていれば「この受信で code_only 償還が成立した」とみなして即 metadata へ反映する
 * （web_approval はこの時点でまだ active 化されないため、再クエリは自然に null を返し何もしない
 * ＝bindingMode を明示的に分岐する必要が無い）。
 *
 * claimCreated:false（無効コード・レート制限・容量超過等）では再クエリ自体を行わない
 * （limbo宛の雑多な発言の大半はここに落ちるため、無駄なDB読み取りを増やさない）。
 *
 * best-effort: 失敗しても claim 償還・沈黙不変条件・返信は既に確定しているため壊さない。
 */
async function backfillServiceUrlAfterClaim(
  account: TeamsPlatformAccount,
  activity: NormalizedTeamsActivity,
  limboResult: { claimCreated: boolean },
  deps: TeamsWebhookDeps,
): Promise<void> {
  if (!limboResult.claimCreated) return

  try {
    const nowActiveGroup = await deps.findActiveGroup(account.id, activity.externalGroupId)
    if (nowActiveGroup) {
      await recordGroupMetadata(nowActiveGroup.id, activity, deps)
    }
  } catch (error) {
    console.error('teams webhook: post-claim metadata backfill failed', error)
  }
}
