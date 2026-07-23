/**
 * limbo→claim 償還と「完了N」処理の共通ヘルパ（rule of three）。
 *
 * Discord(ingestHandler.ts)/Slack(webhookHandler.ts)/Chatwork(webhookHandler.ts) の3チャネルに
 * ほぼ同一（文言は完全一致）でコピーされていた processLimbo / handleDigestCompleteCommand を
 * 1本に集約したもの。無挙動変更リファクタ — ロジック・分岐順序・文言は元の実装と完全一致させる。
 *
 * LINE(line/webhookHandler.ts)は対象外（free・構造が別・本番の要）。ここには一切依存しない。
 *
 * reply は「テキストのみ」を受ける形に正規化してある（credential/channelId はチャネル側で
 * 束縛済み・アカウント種別ごとの reply シグネチャの違いを吸収するのは各 handler 側の責務）。
 */

// 返信文言。存在/理由/プランを推測させないため、無効系は同一文言に畳む（LINE §3 と同思想）。
// 3チャネルの文言はここが単一の正本。各 handler は re-export のみ行う（重複定義しない）。
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

// LINE の ALREADY_DONE_TEXT（line/webhookHandler.ts）と同一文言。LINE 側は重い依存を抱える
// 巨大な処理ファイルのため、意図的に重複させたまま（LINE には一切依存しない）。
export const ALREADY_DONE_TEXT = 'そのタスクは既に完了済みです。'

/** 完了コマンドで実際にタスクを完了できた場合の返信文言。 */
export function buildDigestDoneText(title: string): string {
  return `「${title}」を完了にしました。`
}

export interface ClaimCodeInfo {
  id: string
  orgId: string
  spaceId: string
  bindingMode: 'web_approval' | 'code_only'
}

export interface ClaimLimboParams {
  accountId: string
  externalGroupId: string
  text: string | null
}

export interface ClaimLimboDeps {
  normalizeClaimCode: (content: string) => string | null
  hashClaimCode: (canonical: string) => string
  findValidClaimCode: (codeHash: string, accountId: string) => Promise<ClaimCodeInfo | null>
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
    externalGroupId: string,
    groupDisplayName: string | null,
    // 容量上限（RPCが同一Tx内でアトミックに強制・null=無制限）。ソフトチェックのレース対策。
    maxActiveGroups: number | null,
  ) => Promise<'linked' | 'already_linked' | 'rejected'>
  generateChallengeLabel: () => string
  registerInvalidAttempt: (accountId: string, externalGroupId: string) => boolean
  /** credential/channelId はチャネル側で束縛済み。テキストのみ受ける。 */
  reply: (text: string) => Promise<void>
}

/**
 * limbo（未 claim）グループでの claim コード償還処理（Discord/Slack/Chatwork 共通）。
 * ロジック・分岐順序・文言は元の各チャネル実装（processLimbo）と完全一致。
 */
export async function processClaimLimbo(
  params: ClaimLimboParams,
  deps: ClaimLimboDeps,
): Promise<{ claimCreated: boolean }> {
  const { accountId, externalGroupId, text } = params

  // (1) 本文がコード正準形ですらない通常発言は完全沈黙（無保存・無返信）
  if (!text) return { claimCreated: false }
  const code = deps.normalizeClaimCode(text)
  if (!code) return { claimCreated: false }

  const codeHash = deps.hashClaimCode(code)
  const linkCode = await deps.findValidClaimCode(codeHash, accountId)
  if (!linkCode) {
    // (2) 見つからない/期限切れ/消費済み/対象不一致は同一文言＋レート制限
    const limited = deps.registerInvalidAttempt(accountId, externalGroupId)
    if (!limited) await deps.reply(INVALID_TEXT)
    return { claimCreated: false }
  }

  // チャネル共通Proゲート: 新規紐付けの確立直前。満たさなければ確立させず無効文言に畳む（漏らさない）。
  const entitled = await deps.hasExternalChatChannels(linkCode.orgId)
  if (!entitled) {
    await deps.reply(INVALID_TEXT)
    return { claimCreated: false }
  }
  const cap = await deps.externalChatGroupCapacity(linkCode.orgId)
  if (cap.max !== null && cap.activeCount >= cap.max) {
    await deps.reply(INVALID_TEXT)
    return { claimCreated: false }
  }

  if (linkCode.bindingMode === 'code_only') {
    // 上のソフトチェックに加え、RPC へ上限を渡して確立をアトミックに強制（並行償還のレース対策）。
    const result = await deps.redeemCodeOnly(codeHash, accountId, externalGroupId, null, cap.max)
    const replyText =
      result === 'linked'
        ? CODE_ONLY_LINKED_TEXT
        : result === 'already_linked'
          ? CODE_ONLY_ALREADY_TEXT
          : INVALID_TEXT
    await deps.reply(replyText)
    return { claimCreated: result === 'linked' }
  }

  // web_approval: pending claim を作り確認番号を返す（実際の紐付けは管理画面の承認RPC）
  const challengeLabel = deps.generateChallengeLabel()
  const claim = await deps.createPendingClaim({
    linkCodeId: linkCode.id,
    accountId,
    externalGroupId,
    orgId: linkCode.orgId,
    spaceId: linkCode.spaceId,
    challengeLabel,
    groupDisplayNameSnapshot: null,
  })
  await deps.reply(buildAcceptedText(claim.challengeLabel ?? challengeLabel))
  return { claimCreated: true }
}

/** 秘書の発話（完了コマンドへの応答）の outbound 記録入力（チャネル別 OutboundInput の共通形）。 */
export interface DigestCompletionOutboundInput<TChannel extends string = string> {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: TChannel
  direction: 'outbound'
  actor: 'secretary'
  body: string
  payload: Record<string, unknown>
  status: 'sent'
  error: null
  occurredAt: string
}

export interface DigestCompletionParams<TChannel extends string> {
  orgId: string
  spaceId: string | null
  accountId: string
  groupId: string
  channel: TChannel
  externalUserId: string | null
  /** outbound.payload.autoReplyTo に残す元メッセージの参照（チャネルごとに形式が異なる） */
  autoReplyTo: string
}

export interface DigestCompletionDeps<TChannel extends string> {
  /** digest_number で当該グループの申し送りタスクを完了する（アトミック）。存在しなければ null */
  completeDigestTask: (
    groupId: string,
    digestNumber: number,
    externalUserId: string | null,
  ) => Promise<{ id: string; title: string } | null>
  /** credential/channelId はチャネル側で束縛済み。返信の provider 発行id（無ければnull）を返す。 */
  reply: (text: string) => Promise<{ providerMessageId: string | null }>
  /** 秘書の発話を outbound として記録する */
  insertOutbound: (input: DigestCompletionOutboundInput<TChannel>) => Promise<unknown>
}

/**
 * claimed グループでの「完了N」処理（Discord/Slack/Chatwork 共通）。
 * 呼び出し元で本文は既に通常発言として記録済み（監査ログ）。ここでは完了実行と返信のみ行う。
 * ロジック・順序は元の各チャネル実装（handleDigestCompleteCommand）と完全一致。
 */
export async function runDigestCompletion<TChannel extends string>(
  params: DigestCompletionParams<TChannel>,
  digestNumber: number,
  deps: DigestCompletionDeps<TChannel>,
): Promise<void> {
  const result = await deps.completeDigestTask(params.groupId, digestNumber, params.externalUserId)
  const text = result ? buildDigestDoneText(result.title) : ALREADY_DONE_TEXT
  const replyResult = await deps.reply(text)
  await deps.insertOutbound({
    orgId: params.orgId,
    spaceId: params.spaceId,
    accountId: params.accountId,
    groupId: params.groupId,
    channel: params.channel,
    direction: 'outbound',
    actor: 'secretary',
    body: text,
    payload: { autoReplyTo: params.autoReplyTo, provider_message_id: replyResult.providerMessageId },
    status: 'sent',
    error: null,
    // toISOString(): timestamptz瞬時値用途（date-onlyではない・既存踏襲）。
    occurredAt: new Date().toISOString(),
  })
}
