/**
 * Google Chat アプリ HTTP 入口（@メンション合言葉の claim bootstrap・PR-b）のオーケストレーション。
 *
 * 背景（Fable設計）: Google Chat の全メッセージ購読には Workspace Events API + Pub/Sub が要る
 * （PR-c）。だが購読が無い間、Chat アプリはスペースで **@メンション時しか MESSAGE を受けない**。
 * そこで本ハンドラは「@メンションで投稿された合言葉を受けてグループを claim する入口」だけを担う。
 *
 * **claim = org帰属の正／subscription = 配送手段。分離が背骨。**
 *   - claimed（active channel_groups がある）スペース → **無処理200**。このスペースの通常発言の
 *     取り込みは Pub/Sub 購読（PR-c）が担う。ここで processClaimLimbo を呼ぶと二重処理・二重紐づけ
 *     になるため呼ばない。
 *   - limbo（未 claim）→ 本文が claim コード正準形なら processClaimLimbo（Discord/Slack/Chatwork/
 *     Telegram 共通コア）で償還を試みる。コードでなければ完全沈黙（0行・無返信）。
 *
 * MESSAGE 以外の event type（ADDED_TO_SPACE/REMOVED_FROM_SPACE 等）は無処理200（記録0・発話0）。
 *
 * account は platform 共有アカウント（google_chat・owner_type='platform'）。未設定/見つからない場合は
 * 何もしない200（Discord ingest と同じ骨格）。
 *
 * reply は「返信テキストを捕捉するだけ」の束縛にし、processClaimLimbo 完了後にハンドラが
 * `replyText` として返す。route 側がこれを Chat の同期応答（`{ text }`）に変換する
 * （Chat app は HTTP レスポンス自体がスペースへの発言になる＝outbound送信APIを別途叩かない）。
 *
 * 文言・分岐順序の正本は claimLimboCore.ts（Discord/Slack/Chatwork/Telegram/Google Chat 共通）。
 * ここは re-export のみ行う。
 */
import {
  processClaimLimbo,
  INVALID_TEXT,
  CODE_ONLY_LINKED_TEXT,
  CODE_ONLY_ALREADY_TEXT,
  buildAcceptedText,
} from '@/lib/channels/claimLimboCore'

/** Chat app HTTP interaction event（v1）の受信に必要な最小の形。 */
export interface GoogleChatEvent {
  type: string // 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | ...
  space?: { name?: string }
  message?: {
    name?: string
    text?: string
    // @botメンションを除いた本文。合言葉抽出はこちらを優先する。
    argumentText?: string
  }
  user?: { name?: string }
}

export interface GoogleChatPlatformAccount {
  id: string
}

export interface GoogleChatActiveGroup {
  id: string
  orgId: string
  spaceId: string | null
}

export interface GoogleChatClaimCode {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

export interface GoogleChatWebhookDeps {
  loadPlatformAccount: () => Promise<GoogleChatPlatformAccount | null>
  findActiveGroup: (accountId: string, spaceName: string) => Promise<GoogleChatActiveGroup | null>
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (
    codeHash: string,
    accountId: string,
  ) => Promise<GoogleChatClaimCode | null>
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
    spaceName: string,
    groupDisplayName: string | null,
    // 容量上限（RPCが同一Tx内でアトミックに強制・null=無制限）。ソフトチェックのレース対策。
    maxActiveGroups: number | null,
  ) => Promise<'linked' | 'already_linked' | 'rejected'>
  generateChallengeLabel: () => string
  registerInvalidAttempt: (accountId: string, spaceName: string) => boolean
}

export interface GoogleChatWebhookResult {
  status: 200
  /** Chat への同期応答本文。null は無返信（route は空の200を返す）。 */
  replyText: string | null
}

// 返信文言・limbo償還ロジックの正本は claimLimboCore.ts（Discord/Slack/Chatwork/Telegram/Google Chat
// 共通）。テストが本ファイルから直接 import できるよう re-export する（ローカル重複定義はしない）。
export { INVALID_TEXT, CODE_ONLY_LINKED_TEXT, CODE_ONLY_ALREADY_TEXT, buildAcceptedText }

/**
 * Chat app が受けた interaction event を処理する。
 *
 * 例外は投げない設計にはしていない（route 側が try/catch で 500 に変換する。Google 側の再送は
 * 許容してよい＝claimed/limbo判定前に落ちるのは配線ミス級のバグであり、200で握りつぶすと
 * サイレント欠落になるため）。
 */
export async function handleGoogleChatWebhook(
  event: GoogleChatEvent,
  deps: GoogleChatWebhookDeps,
): Promise<GoogleChatWebhookResult> {
  if (event.type !== 'MESSAGE') {
    return { status: 200, replyText: null }
  }

  const spaceName = event.space?.name
  if (!spaceName) {
    return { status: 200, replyText: null }
  }

  const account = await deps.loadPlatformAccount()
  if (!account) {
    return { status: 200, replyText: null }
  }

  const group = await deps.findActiveGroup(account.id, spaceName)
  if (group) {
    // claimed: 通常の会話取り込みは Pub/Sub 購読（PR-c）の役目。ここで claim ロジックへ
    // 二重に入ると二重処理・二重紐づけになるため触らない。
    return { status: 200, replyText: null }
  }

  // argumentText は @bot メンションを除いた本文（合言葉抽出に最適）。無ければ text にフォールバック。
  const text = event.message?.argumentText ?? event.message?.text ?? ''

  let captured: string | null = null
  await processClaimLimbo(
    { accountId: account.id, externalGroupId: spaceName, text },
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
      reply: (t) => {
        captured = t
        return Promise.resolve()
      },
    },
  )

  return { status: 200, replyText: captured }
}
