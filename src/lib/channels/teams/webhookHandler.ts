/**
 * Microsoft Teams（Bot Framework）messaging endpoint 受信のオーケストレーション（PR-1・claim bootstrap）。
 *
 * 本PRの唯一のゴール: 未 claim グループでの合言葉償還（claim bootstrap）だけを成立させる。
 * claimed グループの通常発言取り込み・「完了N」は PR-2 の役目。このPRでは claimed は
 * 無処理200で返す（google-chat/webhookHandler.ts が Pub/Sub 購読(PR-c)へ委ねているのと同じ
 * 思想。二重処理・二重紐づけを避ける）。
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
import {
  processClaimLimbo,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
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

export interface TeamsWebhookDeps {
  loadPlatformAccount: () => Promise<TeamsPlatformAccount | null>
  findActiveGroup: (accountId: string, channelId: string) => Promise<TeamsActiveGroup | null>
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

// 返信文言・limbo償還ロジックの正本は claimLimboCore.ts。テストが本ファイルから直接 import
// できるよう re-export する（ローカル重複定義はしない）。
export { INVALID_TEXT, CODE_ONLY_LINKED_TEXT, CODE_ONLY_ALREADY_TEXT, buildAcceptedText }

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
    // claimed: 通常の会話取り込み・「完了N」処理は PR-2 の役目。ここで claim ロジックへ
    // 二重に入ると二重処理・二重紐づけになるため触らない。
    return
  }

  await processClaimLimbo(
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
}
