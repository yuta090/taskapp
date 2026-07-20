import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHmac } from 'node:crypto'

/**
 * LINE webhook オーケストレーション
 *
 * 順序厳守: 未検証ボディは destination 抽出以外に使わない
 *   1. destination だけ取り出す → 2. アカウント逆引き → 3. 署名検証 → 4. イベント処理
 *
 * - 署名不正 → 401（何も書かない）
 * - 不明 destination → 200 ignored（LINE再送ループ防止のため常に200系）
 * - テキスト: active identity 1件なら space/identity を確定、0件/複数はnullで記録（人力トリアージ）
 * - リンクコード: 突合成立 → identity作成＋確認メッセージ返信。他orgのコードは無効
 * - follow: system記録＋挨拶（AI名乗り・記録明示の固定文言）
 * - 添付: 受信時にコンテンツ取得→Storage保存（LINE側は期限で消えるため）
 * - dedupe: 同一 message.id の再送では二重記録しない
 */

const CHANNEL_SECRET = 'secret-abc'
const ACCOUNT = {
  id: 'acc-1',
  ownerType: 'org' as const,
  orgId: 'org-1',
  displayName: '山田会計事務所',
  channelSecret: CHANNEL_SECRET,
  accessToken: 'token-xyz',
  status: 'active' as const,
}
const DISABLED_ACCOUNT = { ...ACCOUNT, status: 'disabled' as const }

// 共有bot（owner_type='platform'）。org_idは常にnull — accountからorgを導けない（設計正本§1）
const PLATFORM_ACCOUNT = {
  id: 'acc-shared-1',
  ownerType: 'platform' as const,
  orgId: null as string | null,
  displayName: 'agentpm秘書',
  channelSecret: CHANNEL_SECRET,
  accessToken: 'token-shared',
  status: 'active' as const,
}
const PLATFORM_DISABLED_ACCOUNT = { ...PLATFORM_ACCOUNT, status: 'disabled' as const }

// 共有bot配下のactive世代（承認済み）グループ。org/spaceはgroup由来
const PLATFORM_GROUP = {
  id: 'group-shared-1',
  orgId: 'org-A',
  spaceId: 'space-A',
  accountId: 'acc-shared-1',
  externalGroupId: 'G-1',
  displayName: null,
  status: 'active' as const,
  pickupMode: 'all' as const,
  lastExtractedMessageCreatedAt: null,
  approverUserId: null as string | null,
}

const GROUP = {
  id: 'group-1',
  orgId: 'org-1',
  spaceId: null as string | null,
  accountId: 'acc-1',
  externalGroupId: 'G-1',
  displayName: null,
  status: 'active' as const,
  pickupMode: 'all' as const,
  lastExtractedMessageCreatedAt: null,
  approverUserId: null as string | null,
}

const GROUP_MENTION_ONLY = { ...GROUP, pickupMode: 'mention_only' as const }
const GROUP_OFF = { ...GROUP, pickupMode: 'off' as const }
const GROUP_ALL_PLUS_INSTANT = { ...GROUP, pickupMode: 'all_plus_instant' as const }

const storeMock = {
  findLineAccountByDestination: vi.fn(),
  findActiveLineIdentities: vi.fn(),
  insertChannelMessage: vi.fn(),
  findValidLinkCode: vi.fn(),
  linkIdentityViaCode: vi.fn(),
  uploadAttachment: vi.fn(),
  findOrCreateActiveGroup: vi.fn(),
  findActiveGroup: vi.fn(),
  markGroupLeft: vi.fn(),
  findGroupById: vi.fn(),
  linkGroupToSpaceAtomic: vi.fn(),
  findDigestTaskForVerification: vi.fn(),
  markDigestTaskDoneAtomic: vi.fn(),
  markDigestTaskDoneByGroupAndNumberAtomic: vi.fn(),
  createInstantDigestTask: vi.fn(),
  reopenDigestTaskAtomic: vi.fn(),
  findIdentityIdsByExternalUserIds: vi.fn(),
  backfillDigestAssigneeIdentity: vi.fn(),
  consumeUserLinkCode: vi.fn(),
  expireUserLinkCode: vi.fn(),
  promoteDigestTaskViaLine: vi.fn(),
  rejectDigestTaskViaLine: vi.fn(),
  claimApprovalNotification: vi.fn(),
  clearApprovalNotifiedAt: vi.fn(),
  getOrgChannelPolicyState: vi.fn(),
  getPlatformBudgetState: vi.fn(),
  findValidSharedGroupClaimCode: vi.fn(),
  findOrCreatePendingGroupClaim: vi.fn(),
  redeemCodeOnlyClaim: vi.fn(),
  orgLineGroupCapacity: vi.fn(),
}
vi.mock('@/lib/channels/store', () => storeMock)

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({})),
}))

const resolveOrgEntitlementsMock = vi.fn()
vi.mock('@/lib/billing/entitlements', () => ({
  resolveOrgEntitlements: (...args: unknown[]) => resolveOrgEntitlementsMock(...args),
}))

// code_only 成立通知（Stage 4 PR3b）。ベストエフォート・webhookの主フローをブロックしない
const groupClaimNotifyMock = { notifyCodeOnlyGroupLinked: vi.fn() }
vi.mock('@/lib/channels/groupClaimNotify', () => groupClaimNotifyMock)

// limbo紐付けコード投入のレート制限（Stage 4 §7-8・PR3b）
const limboRateLimitMock = { registerInvalidClaimAttemptAndCheckLimit: vi.fn() }
vi.mock('@/lib/channels/limboRateLimit', () => limboRateLimitMock)

// AC12(docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §10): グループ再リンク(新世代作成)時に
// 旧世代向けsinkをdisableし通知する。ベストエフォート(失敗してもreply等の主フローは継続)。
const sinksStoreMock = { disableStaleGroupSinks: vi.fn() }
vi.mock('@/lib/sinks/store', () => sinksStoreMock)
const sinksNotifyMock = { notifySinkDisabledForRelink: vi.fn() }
vi.mock('@/lib/sinks/notify', () => sinksNotifyMock)

const pushMock = vi.fn()
const fetchContentMock = vi.fn()
const replyMock = vi.fn()
const leaveRoomMock = vi.fn()
const profileMock = vi.fn()
const groupSummaryMock = vi.fn()
vi.mock('@/lib/channels/line/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/channels/line/client')>()
  return {
    ...actual,
    pushLineMessage: (...args: unknown[]) => pushMock(...args),
    fetchLineMessageContent: (...args: unknown[]) => fetchContentMock(...args),
    replyLineMessage: (...args: unknown[]) => replyMock(...args),
    leaveRoom: (...args: unknown[]) => leaveRoomMock(...args),
    fetchGroupMemberProfile: (...args: unknown[]) => profileMock(...args),
    fetchGroupSummary: (...args: unknown[]) => groupSummaryMock(...args),
  }
})

const { handleLineWebhook } = await import('@/lib/channels/line/webhookHandler')

function sign(body: string, secret: string = CHANNEL_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64')
}

function makeBody(events: Record<string, unknown>[]): string {
  return JSON.stringify({ destination: 'Ubot-1', events })
}

function textEvent(text: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    webhookEventId: 'evt-1',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'user', userId: 'U-client-1' },
    replyToken: 'rt-1',
    message: { id: 'msg-1', type: 'text', text },
    ...overrides,
  }
}

function groupTextEvent(text: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'message',
    webhookEventId: 'evt-g1',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'group', groupId: 'G-1', userId: 'U-client-1' },
    replyToken: 'rt-g1',
    message: { id: 'msg-g1', type: 'text', text },
    ...overrides,
  }
}

function joinEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'join',
    webhookEventId: 'evt-join',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'group', groupId: 'G-1' },
    replyToken: 'rt-join',
    ...overrides,
  }
}

function leaveEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'leave',
    webhookEventId: 'evt-leave',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'group', groupId: 'G-1' },
    ...overrides,
  }
}

function roomJoinEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: 'join',
    webhookEventId: 'evt-room-join',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'room', roomId: 'R-1' },
    replyToken: 'rt-room',
    ...overrides,
  }
}

function postbackEvent(data: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'postback',
    webhookEventId: 'evt-postback',
    deliveryContext: { isRedelivery: false },
    timestamp: 1750000000000,
    mode: 'active',
    source: { type: 'group', groupId: 'G-1', userId: 'U-client-1' },
    replyToken: 'rt-postback',
    postback: { data },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SYSTEM_ENCRYPTION_KEY = 'test-encryption-key'
  storeMock.findLineAccountByDestination.mockResolvedValue(ACCOUNT)
  storeMock.findActiveLineIdentities.mockResolvedValue([])
  storeMock.insertChannelMessage.mockResolvedValue({ id: 'row-1' })
  storeMock.findValidLinkCode.mockResolvedValue(null)
  storeMock.findOrCreateActiveGroup.mockResolvedValue(GROUP)
  storeMock.findActiveGroup.mockResolvedValue(GROUP)
  storeMock.findGroupById.mockResolvedValue(GROUP)
  storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)
  storeMock.markGroupLeft.mockResolvedValue(undefined)
  storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map())
  storeMock.backfillDigestAssigneeIdentity.mockResolvedValue(0)
  pushMock.mockResolvedValue(undefined)
  replyMock.mockResolvedValue(undefined)
  leaveRoomMock.mockResolvedValue(undefined)
  profileMock.mockResolvedValue(null)
  storeMock.createInstantDigestTask.mockResolvedValue({ id: 'digest-task-1', pending: false, duplicate: false })
  storeMock.claimApprovalNotification.mockResolvedValue(null)
  storeMock.clearApprovalNotifiedAt.mockResolvedValue(undefined)
  storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
  storeMock.getPlatformBudgetState.mockResolvedValue('ok')
  storeMock.reopenDigestTaskAtomic.mockResolvedValue(null)
  storeMock.findValidSharedGroupClaimCode.mockResolvedValue(null)
  storeMock.findOrCreatePendingGroupClaim.mockResolvedValue({
    id: 'claim-1',
    orgId: 'org-A',
    spaceId: 'space-A',
    challengeLabel: 'AB12',
    status: 'pending',
  })
  groupSummaryMock.mockResolvedValue(null)
  sinksStoreMock.disableStaleGroupSinks.mockResolvedValue([])
  sinksNotifyMock.notifySinkDisabledForRelink.mockResolvedValue(undefined)
  storeMock.redeemCodeOnlyClaim.mockResolvedValue('rejected')
  storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 1, maxGroups: 3 })
  groupClaimNotifyMock.notifyCodeOnlyGroupLinked.mockResolvedValue(undefined)
  limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit.mockReturnValue(false)
  resolveOrgEntitlementsMock.mockResolvedValue({ planId: 'free', has: () => false })
})

describe('handleLineWebhook', () => {
  it('署名不正なら401で何も書かない', async () => {
    const body = makeBody([textEvent('こんにちは')])
    const result = await handleLineWebhook(body, sign(body, 'wrong-secret'))

    expect(result.status).toBe(401)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('署名ヘッダ欠落も401', async () => {
    const body = makeBody([textEvent('x')])
    const result = await handleLineWebhook(body, null)
    expect(result.status).toBe(401)
  })

  it('不明destinationは200 ignored（署名検証不能でも再送ループを作らない）', async () => {
    storeMock.findLineAccountByDestination.mockResolvedValue(null)
    const body = makeBody([textEvent('x')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('JSONでないボディは200 ignored', async () => {
    const result = await handleLineWebhook('not json', 'sig')
    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })

  it('テキスト: identityが1件なら space/identity を確定して記録', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-1' }])
    const body = makeBody([textEvent('請求書を送ります')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        spaceId: 'space-1',
        identityId: 'ident-1',
        accountId: 'acc-1',
        channel: 'line',
        direction: 'inbound',
        actor: 'client',
        externalUserId: 'U-client-1',
        externalMessageId: 'msg-1',
        contentType: 'text',
        body: '請求書を送ります',
      }),
    )
  })

  it('identityが複数件（同一人物が複数顧問先の窓口）なら space/identity はnullで記録', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([
      { id: 'ident-1', spaceId: 'space-1' },
      { id: 'ident-2', spaceId: 'space-2' },
    ])
    const body = makeBody([textEvent('よろしく')])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: null, identityId: null }),
    )
  })

  it('dedupe: 重複はスキップして200', async () => {
    storeMock.insertChannelMessage.mockResolvedValue('duplicate')
    const body = makeBody([textEvent('再送')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('リンクコード: 突合成立 → identity作成＋確認返信＋往復とも記録', async () => {
    storeMock.findValidLinkCode.mockResolvedValue({
      id: 'code-1',
      orgId: 'org-1',
      spaceId: 'space-9',
      firstUsedAt: null,
    })
    storeMock.linkIdentityViaCode.mockResolvedValue({ id: 'ident-9', spaceId: 'space-9' })

    const body = makeBody([textEvent('AB2CD3EF')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.findValidLinkCode).toHaveBeenCalledWith('AB2CD3EF')
    expect(storeMock.linkIdentityViaCode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'code-1' }),
      'U-client-1',
    )
    // inbound(コード) と outbound(確認) の2件
    const directions = storeMock.insertChannelMessage.mock.calls.map(
      (c) => (c[0] as { direction: string }).direction,
    )
    expect(directions).toEqual(['inbound', 'outbound'])
    // inbound はコード成立した identity に帰属
    expect(storeMock.insertChannelMessage.mock.calls[0][0]).toMatchObject({
      identityId: 'ident-9',
      spaceId: 'space-9',
    })
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('他orgのリンクコードは成立しない（未突合ユーザーには案内を返す）', async () => {
    storeMock.findValidLinkCode.mockResolvedValue({
      id: 'code-x',
      orgId: 'org-OTHER',
      spaceId: 'space-x',
      firstUsedAt: null,
    })
    const body = makeBody([textEvent('AB2CD3EF')])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.linkIdentityViaCode).not.toHaveBeenCalled()
    // 未突合(identity 0件)なのでコード案内を返信
    expect(pushMock).toHaveBeenCalledTimes(1)
  })

  it('リンク済みユーザーのコード形状テキスト（参照番号等）は通常メッセージとして帰属を保つ', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-1' }])
    storeMock.findValidLinkCode.mockResolvedValue(null)

    const body = makeBody([textEvent('AB2CD3EF')])
    await handleLineWebhook(body, sign(body))

    // 帰属を失わず記録し、誤った「コードをお確かめください」返信をしない
    expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'space-1', identityId: 'ident-1', body: 'AB2CD3EF' }),
    )
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('リンクコード再送（webhook redelivery）では確認返信を二重送信しない', async () => {
    storeMock.findValidLinkCode.mockResolvedValue({
      id: 'code-1',
      orgId: 'org-1',
      spaceId: 'space-9',
      firstUsedAt: null,
    })
    storeMock.linkIdentityViaCode.mockResolvedValue({ id: 'ident-9', spaceId: 'space-9' })
    storeMock.insertChannelMessage.mockResolvedValue('duplicate')

    const body = makeBody([textEvent('AB2CD3EF')])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('follow再送では挨拶を二重送信しない', async () => {
    storeMock.insertChannelMessage.mockResolvedValue('duplicate')
    const body = makeBody([
      {
        type: 'follow',
        webhookEventId: 'evt-follow',
        deliveryContext: { isRedelivery: true },
        timestamp: 1750000000000,
        mode: 'active',
        source: { type: 'user', userId: 'U-client-1' },
        replyToken: 'rt-2',
      },
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(pushMock).not.toHaveBeenCalled()
  })

  it('follow: system記録＋挨拶（AI名乗り・記録明示）を返信', async () => {
    const body = makeBody([
      {
        type: 'follow',
        webhookEventId: 'evt-follow',
        deliveryContext: { isRedelivery: false },
        timestamp: 1750000000000,
        mode: 'active',
        source: { type: 'user', userId: 'U-client-1' },
        replyToken: 'rt-2',
      },
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(pushMock).toHaveBeenCalledTimes(1)
    const pushArg = pushMock.mock.calls[0][0] as {
      to: string
      messages: { text: string }[]
    }
    expect(pushArg.to).toBe('U-client-1')
    const greeting = pushArg.messages[0].text
    expect(greeting).toContain('山田会計事務所')
    expect(greeting).toContain('AI')
    expect(greeting).toContain('記録に残ります')
  })

  it('画像: コンテンツを取得してStorage保存し storagePath 付きで記録', async () => {
    storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-1' }])
    fetchContentMock.mockResolvedValue({
      data: new ArrayBuffer(8),
      contentType: 'image/jpeg',
    })
    storeMock.uploadAttachment.mockResolvedValue('org-1/line/msg-img-1')

    const body = makeBody([
      textEvent('', {
        message: { id: 'msg-img-1', type: 'image', contentProvider: { type: 'line' } },
      }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(fetchContentMock).toHaveBeenCalledWith('token-xyz', 'msg-img-1')
    expect(storeMock.uploadAttachment).toHaveBeenCalled()
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image',
        storagePath: 'org-1/line/msg-img-1',
        status: 'received',
      }),
    )
  })

  it('画像: コンテンツ取得失敗でも status=failed で記録し200（後からリトライ可能）', async () => {
    fetchContentMock.mockRejectedValue(new Error('content expired'))
    const body = makeBody([
      textEvent('', {
        message: { id: 'msg-img-2', type: 'image', contentProvider: { type: 'line' } },
      }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        contentType: 'image',
        storagePath: null,
        status: 'failed',
        error: expect.stringContaining('content expired'),
      }),
    )
  })

  it('1イベントの処理失敗が他イベントを巻き込まない', async () => {
    storeMock.insertChannelMessage
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ id: 'row-2' })

    const body = makeBody([
      textEvent('1通目', { message: { id: 'm1', type: 'text', text: '1通目' } }),
      textEvent('2通目', { webhookEventId: 'evt-2', message: { id: 'm2', type: 'text', text: '2通目' } }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(2)
  })

  describe('disabled アカウント', () => {
    it('follow: inboundは記録されるが挨拶は送らない', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(DISABLED_ACCOUNT)
      const body = makeBody([
        {
          type: 'follow',
          webhookEventId: 'evt-follow',
          deliveryContext: { isRedelivery: false },
          timestamp: 1750000000000,
          mode: 'active',
          source: { type: 'user', userId: 'U-client-1' },
        },
      ])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('join: グループは記録されるが挨拶は送らない', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(DISABLED_ACCOUNT)
      const body = makeBody([joinEvent()])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.findOrCreateActiveGroup).toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('postback: 消し込みは記録・実行されるが確認replyは送らない', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(DISABLED_ACCOUNT)
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: '酒屋へ発注',
        status: 'open',
        groupId: 'group-1',
        orgId: 'org-1',
        accountId: 'acc-1',
      })
      storeMock.markDigestTaskDoneAtomic.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: '酒屋へ発注',
      })
      const body = makeBody([postbackEvent('action=digest_done&task=11111111-1111-4111-8111-111111111111')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      // 記録・状態確定（消し込み）は継続する。止まるのは自動応答(reply)のみ
      expect(storeMock.markDigestTaskDoneAtomic).toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'system',
          payload: expect.objectContaining({ event: 'postback', result: 'done' }),
        }),
      )
      expect(replyMock).not.toHaveBeenCalled()
    })
  })

  describe('グループ: join', () => {
    it('active世代をupsertし、挨拶をグループへpushする', async () => {
      const body = makeBody([joinEvent()])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.findOrCreateActiveGroup).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1', accountId: 'acc-1', externalGroupId: 'G-1' }),
      )
      expect(pushMock).toHaveBeenCalledTimes(1)
      const pushArg = pushMock.mock.calls[0][0] as { to: string; messages: { text: string }[] }
      expect(pushArg.to).toBe('G-1')
      expect(pushArg.messages[0].text).toContain('記録に残ります')
    })

    it('再送(dedupe)では挨拶を二重送信しない', async () => {
      storeMock.insertChannelMessage.mockResolvedValue('duplicate')
      const body = makeBody([joinEvent()])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  describe('グループ: leave', () => {
    it('active世代をleftにし、systemイベントを記録する', async () => {
      const body = makeBody([leaveEvent()])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.markGroupLeft).toHaveBeenCalledWith('acc-1', 'G-1')
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ actor: 'system', groupId: 'group-1', payload: { event: 'leave' } }),
      )
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  describe('グループ: room招待（非サポート）', () => {
    it('案内をreplyし、roomから退出する', async () => {
      const body = makeBody([roomJoinEvent()])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(replyMock).toHaveBeenCalledTimes(1)
      const replyArg = replyMock.mock.calls[0][0] as { replyToken: string; messages: { text: string }[] }
      expect(replyArg.replyToken).toBe('rt-room')
      expect(replyArg.messages[0].text).toContain('グループトーク')
      expect(leaveRoomMock).toHaveBeenCalledWith('token-xyz', 'R-1')
    })
  })

  describe('グループ発言', () => {
    it('匿名メンバー（userIdなし）の発言も記録される', async () => {
      const body = makeBody([groupTextEvent('明日の仕込みお願いします', { source: { type: 'group', groupId: 'G-1' } })])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: 'group-1',
          externalUserId: null,
          spaceId: null,
          body: '明日の仕込みお願いします',
        }),
      )
    })

    it('別顧問先(space)のidentityしか無い人のグループ発言は、space_idもidentity_idも付けない', async () => {
      // 同一人物が複数顧問先の窓口になり得る（社長が2法人経営等）。
      // 発言者identityは「このグループのspace」のものに限る。org内の先頭を無条件に採ると、
      // 別顧問先のidentityが channel_messages.identity_id に入り（更新不可のため）誤りが残り続ける。
      // Stage 2.6 以降 identity は「担当」の意味を持つため、誤帰属は実害になる。
      storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-OTHER' }])
      storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map())
      const body = makeBody([
        groupTextEvent('お疲れさまです', { source: { type: 'group', groupId: 'G-1', userId: 'U-member' } }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: null, identityId: null }),
      )
    })

    it('同一spaceのidentityを持つ人のグループ発言は identity_id が付く', async () => {
      storeMock.findActiveGroup.mockResolvedValue({ ...GROUP, spaceId: 'space-1' })
      storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map([['U-member', 'ident-1']]))
      const body = makeBody([
        groupTextEvent('お疲れさまです', { source: { type: 'group', groupId: 'G-1', userId: 'U-member' } }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.findIdentityIdsByExternalUserIds).toHaveBeenCalledWith('org-1', 'space-1', [
        'U-member',
      ])
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', identityId: 'ident-1' }),
      )
    })

    it('グループのspace_idが確定していれば発言に反映される', async () => {
      storeMock.findActiveGroup.mockResolvedValue({ ...GROUP, spaceId: 'space-1' })
      const body = makeBody([groupTextEvent('本日の発注分です')])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', groupId: 'group-1' }),
      )
    })

    it('グループ内リンクコード: space確定後に発言者identityを再解決する（帰属を欠落させない）', async () => {
      storeMock.findValidLinkCode.mockResolvedValue({
        id: 'code-1',
        orgId: 'org-1',
        spaceId: 'space-9',
        firstUsedAt: null,
      })
      storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)
      storeMock.findGroupById.mockResolvedValue({ ...GROUP, spaceId: 'space-9' })
      // 紐付け前は space 未確定でidentityを解決できない。確定後の space-9 でだけ解決できる
      storeMock.findIdentityIdsByExternalUserIds.mockImplementation(
        async (_org: string, spaceId: string | null) =>
          spaceId === 'space-9' ? new Map([['U-1', 'ident-9']]) : new Map(),
      )

      const body = makeBody([
        groupTextEvent('AB2CD3EF', { source: { type: 'group', groupId: 'G-1', userId: 'U-1' } }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-9', identityId: 'ident-9' }),
      )
    })

    it('グループ内リンクコード: 未紐付けグループで成立 → space確定＋バックフィル(原子RPC)＋reply確認', async () => {
      storeMock.findValidLinkCode.mockResolvedValue({
        id: 'code-1',
        orgId: 'org-1',
        spaceId: 'space-9',
        firstUsedAt: null,
      })
      storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)

      const body = makeBody([groupTextEvent('AB2CD3EF')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      // 紐付け＋バックフィルは単一RPC(rpc_link_group_to_space)呼び出しに原子化されている
      expect(storeMock.linkGroupToSpaceAtomic).toHaveBeenCalledWith('group-1', 'space-9')
      expect(replyMock).toHaveBeenCalledTimes(1)
      const replyArg = replyMock.mock.calls[0][0] as { replyToken: string }
      expect(replyArg.replyToken).toBe('rt-g1')
      // inbound(コード)がspace-9で記録される
      expect(storeMock.insertChannelMessage.mock.calls[0][0]).toMatchObject({ spaceId: 'space-9' })
    })

    it('AC12: 紐付け成立時に旧世代sinkの無効化を試み、無効化されたsinkごとに通知する', async () => {
      storeMock.findValidLinkCode.mockResolvedValue({
        id: 'code-1',
        orgId: 'org-1',
        spaceId: 'space-9',
        firstUsedAt: null,
      })
      storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)
      sinksStoreMock.disableStaleGroupSinks.mockResolvedValue([
        { sinkId: 'sink-old-1', orgId: 'org-1', displayName: 'Notion連携' },
        { sinkId: 'sink-old-2', orgId: 'org-1', displayName: '自社Webhook' },
      ])

      const body = makeBody([groupTextEvent('AB2CD3EF')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(sinksStoreMock.disableStaleGroupSinks).toHaveBeenCalledWith('group-1')
      expect(sinksNotifyMock.notifySinkDisabledForRelink).toHaveBeenCalledTimes(2)
      expect(sinksNotifyMock.notifySinkDisabledForRelink).toHaveBeenCalledWith(
        'sink-old-1',
        'org-1',
        'Notion連携',
      )
      expect(sinksNotifyMock.notifySinkDisabledForRelink).toHaveBeenCalledWith(
        'sink-old-2',
        'org-1',
        '自社Webhook',
      )
      // 主フロー(reply確認)は継続する
      expect(replyMock).toHaveBeenCalledTimes(1)
    })

    it('AC12: 旧世代sinkが無ければ通知を呼ばない', async () => {
      storeMock.findValidLinkCode.mockResolvedValue({
        id: 'code-1',
        orgId: 'org-1',
        spaceId: 'space-9',
        firstUsedAt: null,
      })
      storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)
      sinksStoreMock.disableStaleGroupSinks.mockResolvedValue([])

      const body = makeBody([groupTextEvent('AB2CD3EF')])
      await handleLineWebhook(body, sign(body))

      expect(sinksStoreMock.disableStaleGroupSinks).toHaveBeenCalledWith('group-1')
      expect(sinksNotifyMock.notifySinkDisabledForRelink).not.toHaveBeenCalled()
    })

    it('AC12: 無効化がレースで紐付け不成立(linked=false)の場合は呼ばない(新世代でないため)', async () => {
      storeMock.findValidLinkCode.mockResolvedValue({
        id: 'code-1',
        orgId: 'org-1',
        spaceId: 'space-9',
        firstUsedAt: null,
      })
      storeMock.linkGroupToSpaceAtomic.mockResolvedValue(false)

      const body = makeBody([groupTextEvent('AB2CD3EF')])
      await handleLineWebhook(body, sign(body))

      expect(sinksStoreMock.disableStaleGroupSinks).not.toHaveBeenCalled()
    })

    it('AC12: sink無効化がエラーでも主フロー(reply確認)は継続する(ベストエフォート)', async () => {
      storeMock.findValidLinkCode.mockResolvedValue({
        id: 'code-1',
        orgId: 'org-1',
        spaceId: 'space-9',
        firstUsedAt: null,
      })
      storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)
      sinksStoreMock.disableStaleGroupSinks.mockRejectedValue(new Error('db down'))

      const body = makeBody([groupTextEvent('AB2CD3EF')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(replyMock).toHaveBeenCalledTimes(1)
    })

    it('既に紐付け済みグループへのコード形状テキストは通常メッセージ扱い', async () => {
      storeMock.findActiveGroup.mockResolvedValue({ ...GROUP, spaceId: 'space-1' })
      const body = makeBody([groupTextEvent('AB2CD3EF')])
      await handleLineWebhook(body, sign(body))

      // リンク処理を試みない（既にspace_idがある）
      expect(storeMock.findValidLinkCode).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-1', body: 'AB2CD3EF' }),
      )
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('「完了2」返信: openかつdigest_number=2を原子更新しreplyで確認（記名Flex）', async () => {
      storeMock.markDigestTaskDoneByGroupAndNumberAtomic.mockResolvedValue({
        id: 'task-2',
        title: '酒屋へ発注',
      })
      const body = makeBody([groupTextEvent('完了2')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.markDigestTaskDoneByGroupAndNumberAtomic).toHaveBeenCalledWith(
        'group-1',
        2,
        'U-client-1',
      )
      expect(replyMock).toHaveBeenCalledTimes(1)
      const replyArg = replyMock.mock.calls[0][0] as { replyToken: string; messages: unknown[] }
      expect(replyArg.replyToken).toBe('rt-g1')
      expect(JSON.stringify(replyArg.messages[0])).toContain('酒屋へ発注')
      expect(JSON.stringify(replyArg.messages[0])).toContain('取り消す')
    })

    it('「完了2」返信でマッチしなければ「既に完了済みです」', async () => {
      storeMock.markDigestTaskDoneByGroupAndNumberAtomic.mockResolvedValue(null)
      const body = makeBody([groupTextEvent('2 完了')])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('既に完了済み') })],
        }),
      )
    })

    it('マッチしない通常メッセージは完了処理を試みない', async () => {
      const body = makeBody([groupTextEvent('了解しました')])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markDigestTaskDoneByGroupAndNumberAtomic).not.toHaveBeenCalled()
    })
  })

  describe('postback（digest_done）', () => {
    const TASK_ID = '11111111-1111-4111-8111-111111111111'

    beforeEach(() => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'open',
        groupId: 'group-1',
        orgId: 'org-1',
        accountId: 'acc-1',
      })
      storeMock.markDigestTaskDoneAtomic.mockResolvedValue({ id: TASK_ID, title: '酒屋へ発注' })
    })

    it('検証OK → 原子更新 → replyで完了を通知（記名Flex） → 消し込み操作をchannel_messagesに証跡として記録', async () => {
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.markDigestTaskDoneAtomic).toHaveBeenCalledWith(TASK_ID, 'postback', 'U-client-1')
      expect(replyMock).toHaveBeenCalledTimes(1)
      const replyArg = replyMock.mock.calls[0][0] as { replyToken: string; messages: unknown[] }
      expect(replyArg.replyToken).toBe('rt-postback')
      expect(JSON.stringify(replyArg.messages[0])).toContain('酒屋へ発注')
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'inbound',
          actor: 'system',
          groupId: 'group-1',
          externalMessageId: 'evt-postback',
          payload: { event: 'postback', action: 'digest_done', taskId: TASK_ID, result: 'done' },
        }),
      )
    })

    it('二重タップの2回目は「既に完了済みです」（証跡にはresult=already_doneで記録）', async () => {
      storeMock.markDigestTaskDoneAtomic.mockResolvedValue(null)
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('既に完了済み') })],
        }),
      )
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ result: 'already_done' }),
        }),
      )
    })

    it('webhook再送(同一webhookEventId)ではreplyを再送しない', async () => {
      storeMock.insertChannelMessage.mockResolvedValue('duplicate')
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('他org/他アカウントのタスクへのpostbackは拒否される（mutation・reply・保存とも0行。世代混同修正で監査行も残さない）', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'open',
        groupId: 'group-OTHER',
        orgId: 'org-OTHER',
        accountId: 'acc-OTHER',
      })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      // 旧世代Flex・偽装taskIdの存在/内容を推測させるオラクルを作らないため、監査行も残さない
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('旧Flex(再紐付け後の旧世代task)のpostbackは拒否される: taskの現active世代不一致はmutation・保存とも0行', async () => {
      // 物理グループGの現active世代(activeGroup=findActiveGroup(...))はGROUP(group-1/org-1)のまま
      // だが、taskは旧世代(group-OLD/org-OLD)を指している = unlink→別テナントへ再紐付け後に
      // 配達済みの旧Flexボタンを押された状況の再現（実害の再現ケース）。
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'open',
        groupId: 'group-OLD',
        orgId: 'org-OLD',
        accountId: 'acc-1',
      })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('旧Flex×limbo(現在active世代が無い)のpostbackも同様に0行', async () => {
      storeMock.findActiveGroup.mockResolvedValue(null)
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'open',
        groupId: 'group-1',
        orgId: 'org-1',
        accountId: 'acc-1',
      })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      // activeGroupが解決できない時点でtask読み取りより前に終了する
      expect(storeMock.findDigestTaskForVerification).not.toHaveBeenCalled()
      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('存在しないtaskIdへのpostbackはmutation・保存とも0行', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue(null)
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('org専用bot: 同一org内で同一物理グループがspace-X→space-Yへ再紐付けされた後の旧Flex(space-Xのtask)は0行（同型バグ）', async () => {
      // 同一account・同一org(org-1)のまま、同一物理グループGが新世代(group-2/space-Y)へ
      // 再紐付けされた後の旧世代(group-1/space-X)向けFlexタップを再現する。
      // task.orgIdはactiveGroup.orgIdと一致してしまう（同一org）ため、group.id不一致だけが
      // 唯一の防波堤になる — ここを見ていないと別spaceのtaskを誤って触れる。
      storeMock.findActiveGroup.mockResolvedValue({ ...GROUP, id: 'group-2', spaceId: 'space-Y' })
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: 'space-Xの旧タスク',
        status: 'open',
        groupId: 'group-1', // 旧世代(space-X)
        orgId: 'org-1',
        accountId: 'acc-1',
      })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('不明なpostback形式は無視する（記録もしない）', async () => {
      const body = makeBody([postbackEvent('action=unknown')])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.findDigestTaskForVerification).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('完了replyの記名: profile取得成功なら表示名を含める', async () => {
      profileMock.mockResolvedValue({ displayName: '田中太郎' })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(profileMock).toHaveBeenCalledWith('token-xyz', 'G-1', 'U-client-1')
      const replyArg = replyMock.mock.calls[0][0] as { messages: unknown[] }
      expect(JSON.stringify(replyArg.messages[0])).toContain('田中太郎さんが')
    })

    it('完了replyの記名: profile取得失敗（null）なら従来文言にフォールバック', async () => {
      profileMock.mockResolvedValue(null)
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      const replyArg = replyMock.mock.calls[0][0] as { messages: unknown[] }
      const serialized = JSON.stringify(replyArg.messages[0])
      expect(serialized).not.toContain('さんが')
      expect(serialized).toContain('『酒屋へ発注』を完了にしました')
    })
  })

  describe('postback（digest_promote / digest_reject・責任者確認 Stage 2.7-B）', () => {
    const TASK_ID = '22222222-2222-4222-8222-222222222222'

    // 責任者確認ボタンは 1:1 トークに届く（source.type='user'）。グループ検証は通らず、
    // アクター解決とテナント/認可は _via_line RPC が完結する。
    function approvalEvent(data: string) {
      return postbackEvent(data, {
        source: { type: 'user', userId: 'U-approver' },
        webhookEventId: 'evt-approve',
        replyToken: 'rt-approve',
      })
    }

    beforeEach(() => {
      storeMock.promoteDigestTaskViaLine.mockResolvedValue({ status: 'promoted', created: true, taskId: 'new-task-1' })
      storeMock.rejectDigestTaskViaLine.mockResolvedValue({ status: 'rejected' })
    })

    it('承認 → webhook検証済みの (account.id, externalUserId, taskId) でRPCを呼ぶ（body由来のUUIDは渡さない）', async () => {
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.promoteDigestTaskViaLine).toHaveBeenCalledWith('acc-1', 'U-approver', TASK_ID, false)
      // 消し込み系RPCは呼ばない（取り違え防止）
      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
    })

    it('「承認して自分がやる」(self=1) → assignSelf=true でRPCを呼ぶ（担当=承認者→Google Tasksへ）', async () => {
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}&self=1`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.promoteDigestTaskViaLine).toHaveBeenCalledWith('acc-1', 'U-approver', TASK_ID, true)
    })

    it('承認成功 → replyでタスク化を通知し、操作を証跡に記録（result=promoted）', async () => {
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).toHaveBeenCalledTimes(1)
      const replyArg = replyMock.mock.calls[0][0] as { replyToken: string; messages: unknown[] }
      expect(replyArg.replyToken).toBe('rt-approve')
      expect(JSON.stringify(replyArg.messages[0])).toContain('タスク')
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'inbound',
          actor: 'system',
          externalMessageId: 'evt-approve',
          payload: { event: 'postback', action: 'digest_promote', taskId: TASK_ID, result: 'promoted' },
        }),
      )
    })

    it('却下 → rejectDigestTaskViaLine を呼び、result=rejected を記録', async () => {
      const body = makeBody([approvalEvent(`action=digest_reject&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.rejectDigestTaskViaLine).toHaveBeenCalledWith('acc-1', 'U-approver', TASK_ID)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { event: 'postback', action: 'digest_reject', taskId: TASK_ID, result: 'rejected' },
        }),
      )
    })

    it('forbidden（責任者でない/紐付け無効）→ 返信も監査行も残さず完全沈黙（例外と外形上区別不能）', async () => {
      storeMock.promoteDigestTaskViaLine.mockResolvedValue({ status: 'forbidden', created: false, taskId: null })
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).not.toHaveBeenCalled()
      // 非承認系は監査行も残さない（forbidden/not_found/例外で行の有無に差を作らない）
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('conflict（既に処理済み）→ 処理済みを通知し result=conflict を記録', async () => {
      storeMock.promoteDigestTaskViaLine.mockResolvedValue({ status: 'conflict', created: false, taskId: null })
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('処理済み') })],
        }),
      )
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ result: 'conflict' }) }),
      )
    })

    it('冪等: 承認済みを再タップ（created=false, status=promoted）→ すでにタスク化済みと返す', async () => {
      storeMock.promoteDigestTaskViaLine.mockResolvedValue({ status: 'promoted', created: false, taskId: 'new-task-1' })
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('すでに') })],
        }),
      )
    })

    it('webhook再送(duplicate)ではreplyを再送しない', async () => {
      storeMock.insertChannelMessage.mockResolvedValue('duplicate')
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).not.toHaveBeenCalled()
    })

    it('グループ由来の承認postbackは動かさない（1:1限定・公開の場に結果を返さない）', async () => {
      // postbackEvent の既定は source.type='group'（グループ）
      const body = makeBody([postbackEvent(`action=digest_promote&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.promoteDigestTaskViaLine).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('ルーム由来の承認postbackも動かさない（fail-closed）', async () => {
      const body = makeBody([
        postbackEvent(`action=digest_promote&task=${TASK_ID}`, {
          source: { type: 'room', roomId: 'R-1', userId: 'U-approver' },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.promoteDigestTaskViaLine).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('RPCが一過性失敗 → 沈黙（forbidden/not_foundと外形上区別不能・監査行も残さない）＋バッチは継続', async () => {
      storeMock.promoteDigestTaskViaLine.mockRejectedValue(new Error('transient'))
      const body = makeBody([approvalEvent(`action=digest_promote&task=${TASK_ID}`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200) // バッチは落とさない
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled() // forbidden と同じく行を残さない
    })
  })

  describe('グループ発言: mention_only 即時タスク化（Stage 2.5 §2）', () => {
    beforeEach(() => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_MENTION_ONLY)
    })

    function mentionEvent(text: string, spans: Array<{ index: number; length: number }>) {
      return groupTextEvent(text, {
        message: {
          id: 'msg-mention-1',
          type: 'text',
          text,
          mention: { mentionees: spans.map((s) => ({ ...s, type: 'user', isSelf: true })) },
        },
      })
    }

    it('メンション付き発言 → 記録＋即時タスク作成＋reply（期限を本文から解決する・Stage 2.6）', async () => {
      // 「金曜まで」の解決は基準日に依存するため時刻を固定する（2026-07-14(火) → 金曜は07-17）
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 14, 10, 30))
      try {
        const body = makeBody([mentionEvent('@AgentPM秘書 金曜までに見積提出', [{ index: 0, length: 10 }])])
        const result = await handleLineWebhook(body, sign(body))

        expect(result.status).toBe(200)
        expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
          expect.objectContaining({ groupId: 'group-1', body: '@AgentPM秘書 金曜までに見積提出' }),
        )
        // org/space/approver は渡さない。DB(RPC)がロックした group 行から確定する
        expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith({
          groupId: 'group-1',
          sourceMessageId: 'row-1',
          title: '金曜までに見積提出',
          assigneeHint: null,
          assigneeExternalUserId: null,
          assigneeIdentityId: null,
          dueDate: '2026-07-17',
          dueTime: null,
        })
        expect(replyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            replyToken: 'rt-g1',
            messages: [
              expect.objectContaining({ text: expect.stringContaining('金曜までに見積提出') }),
            ],
          }),
        )
        // 期限はreplyにも見える形で返す（作成された内容をその場で確認できる）
        const replyText = (replyMock.mock.calls[0][0] as { messages: Array<{ text: string }> })
          .messages[0].text
        expect(replyText).toContain('⏰7/17(金)')
      } finally {
        vi.useRealTimers()
      }
    })

    it('担当者メンション付き → 担当をラベル＋userIdで保存し、タイトルからメンションを除く（Stage 2.6）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 6, 14, 10, 30))
      // identity解決は space 単位。紐付け済みグループで検証する
      storeMock.findActiveGroup.mockResolvedValue({ ...GROUP_MENTION_ONLY, spaceId: 'space-1' })
      storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map([['U-yamada', 'identity-1']]))
      try {
        // '@秘書'=0..2, '@山田'=4..6
        const text = '@秘書 @山田 明日17時までに酒屋へ発注'
        const body = makeBody([
          groupTextEvent(text, {
            message: {
              id: 'msg-mention-assignee',
              type: 'text',
              text,
              mention: {
                mentionees: [
                  { index: 0, length: 3, type: 'user', isSelf: true },
                  { index: 4, length: 3, type: 'user', userId: 'U-yamada' },
                ],
              },
            },
          }),
        ])
        const result = await handleLineWebhook(body, sign(body))

        expect(result.status).toBe(200)
        // 他顧問先のidentityを引かないよう、必ずこのグループの space で解決する
        expect(storeMock.findIdentityIdsByExternalUserIds).toHaveBeenCalledWith('org-1', 'space-1', [
          'U-yamada',
        ])
        expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
          expect.objectContaining({
            title: '明日17時までに酒屋へ発注',
            assigneeHint: '山田',
            assigneeExternalUserId: 'U-yamada',
            assigneeIdentityId: 'identity-1',
            dueDate: '2026-07-15',
            dueTime: '17:00',
          }),
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('未紐付けグループ(space未確定)では identity を解決しない（他顧問先のidentityを流用しない）', async () => {
      // GROUP_MENTION_ONLY.spaceId は null
      storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map())
      const text = '@秘書 @山田 請求書を確認'
      const body = makeBody([
        groupTextEvent(text, {
          message: {
            id: 'msg-mention-nospace',
            type: 'text',
            text,
            mention: {
              mentionees: [
                { index: 0, length: 3, type: 'user', isSelf: true },
                { index: 4, length: 3, type: 'user', userId: 'U-yamada' },
              ],
            },
          },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.findIdentityIdsByExternalUserIds).toHaveBeenCalledWith('org-1', null, [
        'U-yamada',
      ])
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeHint: '山田',
          assigneeExternalUserId: 'U-yamada',
          // spaceが決まっていない以上、どの顧問先の窓口とも言えないため紐付けない
          assigneeIdentityId: null,
        }),
      )
    })

    it('userId が取れないメンション（プロフィール取得未同意）でも名前ラベルは残す（Stage 2.6）', async () => {
      storeMock.findIdentityIdsByExternalUserIds.mockResolvedValue(new Map())
      const text = '@秘書 @田中 請求書を確認'
      const body = makeBody([
        groupTextEvent(text, {
          message: {
            id: 'msg-mention-noid',
            type: 'text',
            text,
            mention: {
              mentionees: [
                { index: 0, length: 3, type: 'user', isSelf: true },
                { index: 4, length: 3, type: 'user' },
              ],
            },
          },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: '請求書を確認',
          assigneeHint: '田中',
          assigneeExternalUserId: null,
          assigneeIdentityId: null,
        }),
      )
    })

    it('webhook再送(duplicate)ではタスクを作らない', async () => {
      storeMock.insertChannelMessage.mockResolvedValue('duplicate')
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('disabledアカウントでは記録のみでタスクを作らない', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(DISABLED_ACCOUNT)
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledTimes(1)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('メンション除去後にtitleが空ならタスクを作らずガイダンスreply', async () => {
      const body = makeBody([mentionEvent('@AgentPM秘書', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('内容が読み取れませんでした') })],
        }),
      )
    })
  })

  describe('グループ発言: mention_only 非メンション合図（PC版LINE対応・本物メンションが付かない端末向け）', () => {
    beforeEach(() => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_MENTION_ONLY)
    })

    it('本文が「@秘書 〇〇」で始まる → 即時タスク化し、合図＋前後空白を除いたtitleになる', async () => {
      const body = makeBody([groupTextEvent('@秘書 見積提出お願いします')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: '見積提出お願いします' }),
      )
      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('見積提出お願いします') })],
        }),
      )
    })

    it('本文が「タスク追加 〇〇」で始まる → 即時タスク化し、合図＋前後空白を除いたtitleになる', async () => {
      const body = makeBody([groupTextEvent('タスク追加 資料を確認する')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: '資料を確認する' }),
      )
    })

    it('先頭でなく文中に「@秘書」がある雑談は発火しない（誤爆防止）', async () => {
      const body = makeBody([groupTextEvent('さっき@秘書って言った？ただの雑談です')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('pickupMode=all のグループでは「@秘書 〇〇」でも即時発火しない（抽出はcron任せ）', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP)
      const body = makeBody([groupTextEvent('@秘書 見積提出お願いします')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('合図除去後にtitleが空（「@秘書」だけ）→ タスクを作らずガイダンスreply', async () => {
      const body = makeBody([groupTextEvent('@秘書')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [expect.objectContaining({ text: expect.stringContaining('内容が読み取れませんでした') })],
        }),
      )
    })
  })

  describe('グループ発言: mention_only 即時 × 責任者承認フロー（Stage 2.7-B §4-5）', () => {
    // 責任者設定＋space紐付け済み。approver の 1:1 送信先が解決できる状態
    const GROUP_APPROVAL = {
      ...GROUP_MENTION_ONLY,
      spaceId: 'space-1' as string | null,
      approverUserId: 'approver-user-1' as string | null,
    }

    function mentionEvent(text: string, spans: Array<{ index: number; length: number }>) {
      return groupTextEvent(text, {
        message: {
          id: 'msg-approval-1',
          type: 'text',
          text,
          mention: { mentionees: spans.map((s) => ({ ...s, type: 'user', isSelf: true })) },
        },
      })
    }

    it('責任者設定＋claim成功 → 先にpending作成→原子的claim→責任者1:1へ確認Flex、returnは確認依頼文', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
      // pending 判定は RPC がロック行から確定して返す（アプリの approver スナップショットに依存しない）
      storeMock.createInstantDigestTask.mockResolvedValue({ id: 'digest-task-1', pending: true, duplicate: false })
      storeMock.claimApprovalNotification.mockResolvedValue('U-approver')
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      // 承認者はアプリからは渡さない（RPCがロックした group 行から確定する。宙吊りpending防止）
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.not.objectContaining({ approverUserId: expect.anything() }),
      )
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: '見積提出' }),
      )
      // 送信は必ず作成後の候補IDに対する原子的claim経由（退職者漏洩防止・二重送信防止をRPCに一元化）
      expect(storeMock.claimApprovalNotification).toHaveBeenCalledWith('digest-task-1')
      // 責任者の1:1へ承認Flex（承認/却下 postback＋二重送信防止 retryKey）
      expect(pushMock).toHaveBeenCalledTimes(1)
      const pushArg = pushMock.mock.calls[0][0] as {
        to: string
        messages: unknown[]
        retryKey?: string
      }
      expect(pushArg.to).toBe('U-approver')
      expect(pushArg.retryKey).toBeTruthy()
      const serialized = JSON.stringify(pushArg.messages[0])
      expect(serialized).toContain('action=digest_promote&task=digest-task-1')
      expect(serialized).toContain('action=digest_reject&task=digest-task-1')
      // グループには承認依頼の旨だけ返す（即時タスク化はしない）
      const replyText = (replyMock.mock.calls[0][0] as { messages: Array<{ text: string }> })
        .messages[0].text
      expect(replyText).toContain('責任者に確認')
      expect(replyText).not.toContain('タスクに追加しました')
    })

    it('claimがnull（権限なし/リンク未解決）→ pendingは作るがpushしない（コンソール/cronがフォールバック）', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
      storeMock.createInstantDigestTask.mockResolvedValue({ id: 'digest-task-1', pending: true, duplicate: false })
      storeMock.claimApprovalNotification.mockResolvedValue(null)
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.claimApprovalNotification).toHaveBeenCalledWith('digest-task-1')
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('即時1:1送信が失敗 → 未通知に戻し(clearApprovalNotifiedAt)、reply主フローは続行', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
      storeMock.createInstantDigestTask.mockResolvedValue({ id: 'digest-task-1', pending: true, duplicate: false })
      storeMock.claimApprovalNotification.mockResolvedValue('U-approver')
      pushMock.mockRejectedValueOnce(new Error('LINE 429'))
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.clearApprovalNotifiedAt).toHaveBeenCalledWith('digest-task-1')
      expect(replyMock).toHaveBeenCalledTimes(1)
    })

    it('claim RPCが一時障害で例外 → 候補は残す・pushせず・webhookは200で継続（候補取りこぼし防止）', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
      storeMock.createInstantDigestTask.mockResolvedValue({ id: 'digest-task-1', pending: true, duplicate: false })
      storeMock.claimApprovalNotification.mockRejectedValueOnce(new Error('DB timeout'))
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      // 候補は claim より前に作成済み（cron/コンソールが拾える）。webhookは落とさない
      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledTimes(1)
      expect(pushMock).not.toHaveBeenCalled()
      expect(replyMock).toHaveBeenCalledTimes(1)
    })

    it('RPCが is_pending=false を返せば承認フローに乗せず従来どおり即時タスク化', async () => {
      // space 未紐付け等で RPC が pending=false を確定した場合。webhook はその値に従う
      storeMock.findActiveGroup.mockResolvedValue({
        ...GROUP_APPROVAL,
        spaceId: null,
      })
      storeMock.createInstantDigestTask.mockResolvedValue({ id: 'digest-task-1', pending: false, duplicate: false })
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.claimApprovalNotification).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
      const replyText = (replyMock.mock.calls[0][0] as { messages: Array<{ text: string }> })
        .messages[0].text
      expect(replyText).toContain('タスクに追加しました')
    })

    it('webhook再送(duplicate)では claim も push もしない', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
      // 重複: id=null・pending は現在値（true）で返るが、新規でないので claim/push しない
      storeMock.createInstantDigestTask.mockResolvedValue({ id: null, pending: true, duplicate: true })
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.claimApprovalNotification).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
      expect(storeMock.clearApprovalNotifiedAt).not.toHaveBeenCalled()
    })

    describe('メータリング（PR4・即時approval pushのgate＋billable計上）', () => {
      beforeEach(() => {
        // RPC が pending=true を確定した新規候補（GROUP_APPROVAL）に対して、即時 approval push の
        // gate と billable 計上を検証する。pending は RPC 返値なので明示する（handler は自前判定しない）。
        storeMock.createInstantDigestTask.mockResolvedValue({
          id: 'digest-task-1',
          pending: true,
          duplicate: false,
        })
      })

      it('push成功時: billablePush:trueのoutbound記録を1件残す（cronと同一のexternalMessageIdで冪等）', async () => {
        storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
        storeMock.claimApprovalNotification.mockResolvedValue('U-approver')
        storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
        const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
        await handleLineWebhook(body, sign(body))

        expect(pushMock).toHaveBeenCalledTimes(1)
        const retryKey = (pushMock.mock.calls[0][0] as { retryKey: string }).retryKey
        expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            direction: 'outbound',
            actor: 'secretary',
            groupId: null,
            externalUserId: 'U-approver',
            externalMessageId: retryKey,
            billablePush: true,
            status: 'sent',
          }),
        )
      })

      it('on_exceed=block かつ state=hard は claim も push もしない（候補はpendingのまま残す）', async () => {
        storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
        storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'hard', onExceed: 'block' })
        const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
        const result = await handleLineWebhook(body, sign(body))

        expect(result.status).toBe(200)
        expect(storeMock.createInstantDigestTask).toHaveBeenCalledTimes(1)
        expect(storeMock.claimApprovalNotification).not.toHaveBeenCalled()
        expect(pushMock).not.toHaveBeenCalled()
        expect(storeMock.insertChannelMessage).not.toHaveBeenCalledWith(
          expect.objectContaining({ billablePush: true }),
        )
        // グループへの主フローreplyは継続する（抑止は通知のみに影響）
        expect(replyMock).toHaveBeenCalledTimes(1)
      })

      it('on_exceed=degrade かつ state=soft の隔日休止日は claim も push もしない', async () => {
        vi.useFakeTimers()
        // 2026-07-12(JST)は通算日193（奇数）→ 抑止側
        vi.setSystemTime(new Date(2026, 6, 12, 7, 0))
        storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
        storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'soft', onExceed: 'degrade' })

        try {
          const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
          await handleLineWebhook(body, sign(body))

          expect(storeMock.claimApprovalNotification).not.toHaveBeenCalled()
          expect(pushMock).not.toHaveBeenCalled()
        } finally {
          vi.useRealTimers()
        }
      })
    })

    describe('グローバル予算層（共有bot account軸の二層quota判定・fable確定設計）', () => {
      beforeEach(() => {
        storeMock.createInstantDigestTask.mockResolvedValue({
          id: 'digest-task-1',
          pending: true,
          duplicate: false,
        })
      })

      it('共有bot(platform)account かつ org層ok・global層hard → claimもpushもしない', async () => {
        storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_ACCOUNT)
        storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
        storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
        storeMock.getPlatformBudgetState.mockResolvedValue('hard')

        const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
        const result = await handleLineWebhook(body, sign(body))

        expect(result.status).toBe(200)
        expect(storeMock.getPlatformBudgetState).toHaveBeenCalledWith('acc-shared-1')
        expect(storeMock.claimApprovalNotification).not.toHaveBeenCalled()
        expect(pushMock).not.toHaveBeenCalled()
        // グループへの主フローreplyは継続する（抑止は通知のみに影響）
        expect(replyMock).toHaveBeenCalledTimes(1)
      })

      it('専用bot(owner_type=org)account は global層を評価しない（getPlatformBudgetStateを呼ばず通常どおりclaim/push）', async () => {
        storeMock.findLineAccountByDestination.mockResolvedValue(ACCOUNT) // ownerType='org'
        storeMock.findActiveGroup.mockResolvedValue(GROUP_APPROVAL)
        storeMock.claimApprovalNotification.mockResolvedValue('U-approver')
        storeMock.getOrgChannelPolicyState.mockResolvedValue({ state: 'ok', onExceed: 'none' })
        storeMock.getPlatformBudgetState.mockResolvedValue('hard') // 呼ばれれば抑止されるはずの値

        const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
        await handleLineWebhook(body, sign(body))

        expect(storeMock.getPlatformBudgetState).not.toHaveBeenCalled()
        expect(pushMock).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('グループ発言: pickup_mode=all/off とメンション', () => {
    it('all モードではメンションでも即時タスク化しない（夜間抽出に任せる）', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP)
      const body = makeBody([
        groupTextEvent('@AgentPM秘書 見積提出', {
          message: {
            id: 'msg-mention-all',
            type: 'text',
            text: '@AgentPM秘書 見積提出',
            mention: { mentionees: [{ index: 0, length: 8, type: 'user', isSelf: true }] },
          },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('off モードでは通常発言も記録のみ（完了コマンド等の自動応答も動かない前提はcron側の対象外判定で担保。ここでは記録のみを確認）', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_OFF)
      const body = makeBody([groupTextEvent('いつもの発注お願いします')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'group-1', body: 'いつもの発注お願いします' }),
      )
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
    })
  })

  describe('グループ発言: all_plus_instant（フェーズ2・pro以上限定・実行時ゲート）', () => {
    beforeEach(() => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_ALL_PLUS_INSTANT)
    })

    function mentionEvent(text: string, spans: Array<{ index: number; length: number }>) {
      return groupTextEvent(text, {
        message: {
          id: 'msg-dual-1',
          type: 'text',
          text,
          mention: { mentionees: spans.map((s) => ({ ...s, type: 'user', isSelf: true })) },
        },
      })
    }

    it('entitled org（pro）: 「@秘書 〇〇」で即時タスク化が発火する', async () => {
      resolveOrgEntitlementsMock.mockResolvedValue({ planId: 'pro', has: () => true })
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(resolveOrgEntitlementsMock).toHaveBeenCalledWith(expect.anything(), 'org-1')
      expect(storeMock.createInstantDigestTask).toHaveBeenCalledWith(
        expect.objectContaining({ title: '見積提出' }),
      )
      expect(replyMock).toHaveBeenCalled()
    })

    it('非entitled org（free）: 「@秘書 〇〇」でも即時発火せず記録のみ（all相当に縮退）', async () => {
      resolveOrgEntitlementsMock.mockResolvedValue({ planId: 'free', has: () => false })
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      // 通常メッセージとして記録される（毎時抽出はcron側が拾う）
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ groupId: 'group-1', body: '@AgentPM秘書 見積提出' }),
      )
    })

    it('非メンション合図（PC版LINE対応）も同様にentitledのみ即時発火する', async () => {
      resolveOrgEntitlementsMock.mockResolvedValue({ planId: 'free', has: () => false })
      const body = makeBody([groupTextEvent('@秘書 見積提出お願いします')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
    })

    it('回帰: line_pickup_dual_mode(Freeにも開放済み)がtrueでもinstant_line_notifyが無ければ即時発火しない（差別化は即時性で行う・事業判断2026-07）', async () => {
      // 実際のFreeプランのentitlements解決を模す: line_pickup_dual_modeはtrue・instant_line_notifyはfalse
      resolveOrgEntitlementsMock.mockResolvedValue({
        planId: 'free',
        has: (f: string) => f === 'line_pickup_dual_mode',
      })
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('entitlement解決がエラーでも例外を投げず即時化しない（fail-closed）', async () => {
      resolveOrgEntitlementsMock.mockRejectedValue(new Error('DB down'))
      const body = makeBody([mentionEvent('@AgentPM秘書 見積提出', [{ index: 0, length: 10 }])])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
    })

    it('メンション/合図が無い通常発言はentitlement解決自体を呼ばない（無駄なDB呼び出しをしない）', async () => {
      const body = makeBody([groupTextEvent('いつもの発注お願いします')])
      await handleLineWebhook(body, sign(body))

      expect(resolveOrgEntitlementsMock).not.toHaveBeenCalled()
      expect(storeMock.createInstantDigestTask).not.toHaveBeenCalled()
    })
  })

  describe('グループ発言: mention_only はentitlement解決を呼ばない（無料機能）', () => {
    it('mention_only × メンション付き発言 → resolveOrgEntitlementsは呼ばれない', async () => {
      storeMock.findActiveGroup.mockResolvedValue(GROUP_MENTION_ONLY)
      const body = makeBody([
        groupTextEvent('@AgentPM秘書 見積提出', {
          message: {
            id: 'msg-mention-free',
            type: 'text',
            text: '@AgentPM秘書 見積提出',
            mention: { mentionees: [{ index: 0, length: 8, type: 'user', isSelf: true }] },
          },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(resolveOrgEntitlementsMock).not.toHaveBeenCalled()
      expect(storeMock.createInstantDigestTask).toHaveBeenCalled()
    })
  })

  describe('postback（digest_undo・Stage 2.5 §3-2）', () => {
    const TASK_ID = '11111111-1111-4111-8111-111111111111'

    beforeEach(() => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'done',
        groupId: 'group-1',
        orgId: 'org-1',
        accountId: 'acc-1',
      })
    })

    it('24時間以内 → 原子reopen → 成功replyで「タスクに戻しました」', async () => {
      storeMock.reopenDigestTaskAtomic.mockResolvedValue({ id: TASK_ID, title: '酒屋へ発注' })
      const body = makeBody([postbackEvent(`action=digest_undo&task=${TASK_ID}`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.reopenDigestTaskAtomic).toHaveBeenCalledWith(TASK_ID)
      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          replyToken: 'rt-postback',
          messages: [
            expect.objectContaining({ text: expect.stringContaining('酒屋へ発注') }),
          ],
        }),
      )
      const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
      expect(replyArg.messages[0].text).toContain('タスクに戻しました')
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ event: 'postback', action: 'digest_undo', taskId: TASK_ID, result: 'reopened' }),
        }),
      )
    })

    it('24時間超過・既にopen等（0行） → 失敗replyでコンソール誘導', async () => {
      storeMock.reopenDigestTaskAtomic.mockResolvedValue(null)
      const body = makeBody([postbackEvent(`action=digest_undo&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            expect.objectContaining({
              text: expect.stringContaining('取り消せませんでした'),
            }),
          ],
        }),
      )
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ result: 'cannot_undo' }) }),
      )
    })

    it('他org/他グループのタスクへのundoは拒否され無応答・0行（世代混同修正で監査行も残さない）', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'done',
        groupId: 'group-OTHER',
        orgId: 'org-OTHER',
        accountId: 'acc-OTHER',
      })
      const body = makeBody([postbackEvent(`action=digest_undo&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.reopenDigestTaskAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('旧Flex(再紐付け後の旧世代task)のundoは拒否される: taskの現active世代不一致はmutation・保存とも0行', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'done',
        groupId: 'group-OLD',
        orgId: 'org-OLD',
        accountId: 'acc-1',
      })
      const body = makeBody([postbackEvent(`action=digest_undo&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.reopenDigestTaskAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('digest_doneとdigest_undoは判別され、digest_doneのpostbackはreopenを呼ばない', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: TASK_ID,
        title: '酒屋へ発注',
        status: 'open',
        groupId: 'group-1',
        orgId: 'org-1',
        accountId: 'acc-1',
      })
      storeMock.markDigestTaskDoneAtomic.mockResolvedValue({ id: TASK_ID, title: '酒屋へ発注' })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.reopenDigestTaskAtomic).not.toHaveBeenCalled()
      expect(storeMock.markDigestTaskDoneAtomic).toHaveBeenCalled()
    })
  })
})

/**
 * Stage 2.7-A: 内部ユーザーの LINE 本人紐付け
 *
 * 最重要: channel_messages は append-only（トリガー強制）。認証コードを平文で入れたら
 * redaction 以外では二度と消せない。よって「保存する前に」マスクしなければならない。
 */
describe('内部ユーザーの本人紐付けコード（TA-...）', () => {
  const CODE = 'TA-0123456789ABCDEFGHJKMNPQRS'

  beforeEach(() => {
    storeMock.findLineAccountByDestination.mockResolvedValue(ACCOUNT)
    storeMock.findActiveLineIdentities.mockResolvedValue([])
    storeMock.insertChannelMessage.mockResolvedValue('inserted')
    storeMock.consumeUserLinkCode.mockResolvedValue({ status: 'ok', linkId: 'link-1' })
    storeMock.expireUserLinkCode.mockResolvedValue(undefined)
  })

  it('1:1でコードを送ると、会話ログには平文が残らずマスクされる', async () => {
    const body = makeBody([textEvent(CODE)])
    await handleLineWebhook(body, sign(body))

    // 受信の記録に加え、秘書の返信も outbound として記録される（2件）。
    // 重要なのは「どの記録にもコード平文が混入しない」こと
    const bodies = storeMock.insertChannelMessage.mock.calls.map((c) => c[0].body)
    expect(bodies[0]).toBe('[認証コード]')
    for (const body of bodies) {
      expect(body ?? '').not.toContain(CODE)
    }
  })

  it('1:1でコードを送ると紐付けRPCが呼ばれ、成功を返信する', async () => {
    const body = makeBody([textEvent(CODE)])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.consumeUserLinkCode).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/), // 平文ではなく sha256 を渡す
      'acc-1',
      'U-client-1',
    )
    expect(pushMock.mock.calls.length + replyMock.mock.calls.length).toBeGreaterThan(0)
  })

  it('小文字・前後空白でも紐付けが成立する（入力ゆれの吸収）', async () => {
    const body = makeBody([textEvent(`  ${CODE.toLowerCase()}  `)])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.consumeUserLinkCode).toHaveBeenCalled()
    expect(storeMock.insertChannelMessage.mock.calls[0][0].body).toBe('[認証コード]')
  })

  it('locked のときは総当たりの手掛かりを与えず、時間をおくよう返す', async () => {
    storeMock.consumeUserLinkCode.mockResolvedValue({ status: 'locked', linkId: null })
    const body = makeBody([textEvent(CODE)])
    await handleLineWebhook(body, sign(body))

    const sent = JSON.stringify([...pushMock.mock.calls, ...replyMock.mock.calls])
    expect(sent).toContain('試行回数')
  })

  it('グループに貼られたコードは紐付けを成立させず、即座に失効させる', async () => {
    storeMock.findActiveGroup.mockResolvedValue(GROUP)
    const body = makeBody([groupTextEvent(CODE)])
    await handleLineWebhook(body, sign(body))

    // グループの全員が読めてしまうので、紐付けは絶対に成立させない
    expect(storeMock.consumeUserLinkCode).not.toHaveBeenCalled()
    // 見た人が使えないよう、コードは即時失効
    expect(storeMock.expireUserLinkCode).toHaveBeenCalledWith(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    )
    // グループの会話ログにも平文を残さない
    const record = storeMock.insertChannelMessage.mock.calls[0][0]
    expect(record.body).toBe('[認証コード]')
  })

  it('通常の会話はマスクされない（誤検出しない）', async () => {
    const body = makeBody([textEvent('明日までにお願いします')])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.consumeUserLinkCode).not.toHaveBeenCalled()
    expect(storeMock.insertChannelMessage.mock.calls[0][0].body).toBe('明日までにお願いします')
  })
})

/**
 * 回帰テスト（Codex セキュリティレビューで発見・High）
 *
 * 検出は部分一致なのにハッシュは本文全体、という食い違いがあった。
 * その結果「このコードです TA-xxx よろしく」とグループへ誤爆されると、
 * 表示はマスクされるのに *コードが失効せず*、グループにいる顧客が
 * 見えているコードをコピーして1:1に送るだけで「責任者」として紐付けられた。
 */
describe('コードは本文全体ではなく抽出した値でハッシュする', () => {
  const CODE = 'TA-0123456789ABCDEFGHJKMNPQRS'
  let expectedHash: string

  beforeEach(async () => {
    const { hashUserLinkCode } = await import('@/lib/channels/userLink')
    expectedHash = hashUserLinkCode(CODE)

    storeMock.findLineAccountByDestination.mockResolvedValue(ACCOUNT)
    storeMock.findActiveLineIdentities.mockResolvedValue([])
    storeMock.insertChannelMessage.mockResolvedValue('inserted')
    storeMock.consumeUserLinkCode.mockResolvedValue({ status: 'ok', linkId: 'link-1' })
    storeMock.expireUserLinkCode.mockResolvedValue(true)
  })

  it('1:1で前後に文章が付いていても、正しいコードのハッシュで消費する', async () => {
    const body = makeBody([textEvent(`このコードです ${CODE} よろしくお願いします`)])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.consumeUserLinkCode).toHaveBeenCalledWith(expectedHash, 'acc-1', 'U-client-1')
  })

  it('グループに文章付きで貼られても、正しいコードのハッシュで失効させる', async () => {
    storeMock.findActiveGroup.mockResolvedValue(GROUP)
    const body = makeBody([groupTextEvent(`これです ${CODE} 使ってください`)])
    await handleLineWebhook(body, sign(body))

    // ここが本文全体のハッシュだと失効せず、見た人がコードを使えてしまう
    expect(storeMock.expireUserLinkCode).toHaveBeenCalledWith(expectedHash)
    expect(storeMock.consumeUserLinkCode).not.toHaveBeenCalled()
  })

  it('失効できなかった場合は「無効化しました」と断言しない', async () => {
    storeMock.findActiveGroup.mockResolvedValue(GROUP)
    storeMock.expireUserLinkCode.mockResolvedValue(false)
    const body = makeBody([groupTextEvent(`これです ${CODE}`)])
    await handleLineWebhook(body, sign(body))

    const sent = JSON.stringify(replyMock.mock.calls)
    expect(sent).not.toContain('無効化しました')
  })
})

/**
 * 共有bot（owner_type='platform'）マルチテナント境界（Stage 4 §1/§3/§4・PR2）
 *
 * - account.orgIdは常にnull。帰属は必ずchannel_groups(group.orgId)から取る。
 * - webhookはgroup行を作らない（承認RPCファミリ経由のみ）。
 * - 1:1/roomはorg解決不能 → 保存ゼロ＋定型案内reply。
 * - 未承認グループ(limbo)は保存ゼロ。紐付けコード投入(web_approval)のみclaim登録＋チャレンジreply。
 * - active世代(承認済み)のグループは以降org専用botと同じ経路（group.orgId起点）で動く。
 */
describe('共有bot（owner_type=platform）マルチテナント境界', () => {
  beforeEach(() => {
    storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_ACCOUNT)
  })

  describe('1:1（follow / メッセージ）: org解決不能 → 保存ゼロ＋定型案内', () => {
    it('follow: 保存せず定型案内をpushする（identityリンク非対応）', async () => {
      const body = makeBody([
        {
          type: 'follow',
          webhookEventId: 'evt-follow-shared',
          deliveryContext: { isRedelivery: false },
          timestamp: 1750000000000,
          mode: 'active',
          source: { type: 'user', userId: 'U-someone' },
        },
      ])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(pushMock).toHaveBeenCalledTimes(1)
      const pushArg = pushMock.mock.calls[0][0] as { to: string; messages: { text: string }[] }
      expect(pushArg.to).toBe('U-someone')
      expect(pushArg.messages[0].text).toContain('個別のトーク')
    })

    it('disabled中のfollowはpushしない', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_DISABLED_ACCOUNT)
      const body = makeBody([
        {
          type: 'follow',
          webhookEventId: 'evt-follow-shared-2',
          deliveryContext: { isRedelivery: false },
          timestamp: 1750000000000,
          mode: 'active',
          source: { type: 'user', userId: 'U-someone' },
        },
      ])
      await handleLineWebhook(body, sign(body))
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('unfollowは何も保存しない', async () => {
      const body = makeBody([
        {
          type: 'unfollow',
          webhookEventId: 'evt-unfollow-shared',
          deliveryContext: { isRedelivery: false },
          timestamp: 1750000000000,
          mode: 'active',
          source: { type: 'user', userId: 'U-someone' },
        },
      ])
      await handleLineWebhook(body, sign(body))
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('1:1テキストは保存せずreplyで定型案内する（TA-コード形状でも本人紐付けは行わない）', async () => {
      const body = makeBody([textEvent('相談したいことがあります', { source: { type: 'user', userId: 'U-someone' } })])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(storeMock.findActiveLineIdentities).not.toHaveBeenCalled()
      expect(replyMock).toHaveBeenCalledTimes(1)
      const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
      expect(replyArg.messages[0].text).toContain('グループトーク')
    })

    it('disabled中の1:1テキストはreplyしない', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_DISABLED_ACCOUNT)
      const body = makeBody([textEvent('相談です', { source: { type: 'user', userId: 'U-someone' } })])
      await handleLineWebhook(body, sign(body))
      expect(replyMock).not.toHaveBeenCalled()
    })
  })

  describe('グループjoin: group行を作らず挨拶のみ（承認RPC経由のみ紐付け）', () => {
    it('findOrCreateActiveGroupを呼ばず、承認完了まで記録されない旨を明示した挨拶をpushする', async () => {
      const body = makeBody([joinEvent()])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.findOrCreateActiveGroup).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(pushMock).toHaveBeenCalledTimes(1)
      const pushArg = pushMock.mock.calls[0][0] as { to: string; messages: { text: string }[] }
      expect(pushArg.to).toBe('G-1')
      expect(pushArg.messages[0].text).toContain('記録されません')
    })

    it('disabled中は挨拶しない（groupも作らない）', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_DISABLED_ACCOUNT)
      const body = makeBody([joinEvent()])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.findOrCreateActiveGroup).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
    })
  })

  describe('未承認グループ(limbo): 通常発言/添付/postbackは0行（設計正本§8(d)）', () => {
    beforeEach(() => {
      storeMock.findActiveGroup.mockResolvedValue(null)
    })

    it('通常の発言は保存もreplyもしない', async () => {
      const body = makeBody([groupTextEvent('明日納品お願いします')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(pushMock).not.toHaveBeenCalled()
    })

    it('添付は取得も保存もしない', async () => {
      const body = makeBody([
        groupTextEvent('', {
          message: { id: 'msg-shared-img', type: 'image', contentProvider: { type: 'line' } },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(fetchContentMock).not.toHaveBeenCalled()
      expect(storeMock.uploadAttachment).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('旧Flex×limbo: digest_done postbackは記録しない(0行)。activeGroup未解決の時点でtask読み取りより前に終了する', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'ダミー',
        status: 'open',
        groupId: 'group-shared-1',
        orgId: 'org-A',
        accountId: 'acc-shared-1',
      })
      const body = makeBody([
        postbackEvent('action=digest_done&task=11111111-1111-4111-8111-111111111111', {
          source: { type: 'group', groupId: 'G-1', userId: 'U-1' },
        }),
      ])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.findDigestTaskForVerification).not.toHaveBeenCalled()
      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('旧Flex×undo(limbo): digest_undo postbackも同様に0行', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'ダミー',
        status: 'done',
        groupId: 'group-shared-1',
        orgId: 'org-A',
        accountId: 'acc-shared-1',
      })
      const body = makeBody([
        postbackEvent('action=digest_undo&task=11111111-1111-4111-8111-111111111111', {
          source: { type: 'group', groupId: 'G-1', userId: 'U-1' },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.reopenDigestTaskAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('責任者確認(digest_promote)postbackは共有botでは処理されない（1:1連携未対応・完全沈黙）', async () => {
      const body = makeBody([
        postbackEvent('action=digest_promote&task=22222222-2222-4222-8222-222222222222', {
          source: { type: 'user', userId: 'U-approver' },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.promoteDigestTaskViaLine).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
    })

    it('内部コード(TA-)漏洩時は記録せず失効・replyのみ行う', async () => {
      const CODE = 'TA-0123456789ABCDEFGHJKMNPQRS'
      storeMock.expireUserLinkCode.mockResolvedValue(true)
      const body = makeBody([groupTextEvent(`これです ${CODE}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.expireUserLinkCode).toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
      expect(replyMock).toHaveBeenCalledTimes(1)
    })

    it('leave: markGroupLeftは呼ぶが記録はしない', async () => {
      const body = makeBody([leaveEvent()])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markGroupLeft).toHaveBeenCalledWith('acc-shared-1', 'G-1')
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    describe('紐付けコード投入（Fable裁定・確定形状: 31文字集合×26文字。GC-プレフィクス表示）', () => {
      // 31文字集合(ALPHABET)のみで構成した26文字正準形
      const CANONICAL = 'ABCDEFGHJKMNPQRSTUVWXYZ234'
      // 表示形式（GC-プレフィクス＋ハイフン区切り）。normalizeClaimCodeで正準形へ収束する
      const DISPLAY_FORM = 'GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234'

      it('web_approvalの有効コード(GC-表示形式): claimを登録しチャレンジ番号入りでreplyする。hash入力は26文字正準形', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
          id: 'code-1',
          orgId: 'org-A',
          spaceId: 'space-A',
          bindingMode: 'web_approval',
        })
        groupSummaryMock.mockResolvedValue({ groupName: 'ある会社の相談グループ' })
        storeMock.findOrCreatePendingGroupClaim.mockResolvedValue({
          id: 'claim-1',
          orgId: 'org-A',
          spaceId: 'space-A',
          challengeLabel: 'QW3R',
          status: 'pending',
        })

        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        const result = await handleLineWebhook(body, sign(body))

        expect(result.status).toBe(200)
        // hash入力は正準形(26文字本体)であること（発行側=PR3と同じ正準形をHMACする前提）
        const { hashSharedGroupClaimCode } = await import('@/lib/channels/sharedGroupClaim')
        expect(storeMock.findValidSharedGroupClaimCode).toHaveBeenCalledWith(
          hashSharedGroupClaimCode(CANONICAL),
          'acc-shared-1',
        )
        expect(storeMock.findOrCreatePendingGroupClaim).toHaveBeenCalledWith(
          expect.objectContaining({
            linkCodeId: 'code-1',
            accountId: 'acc-shared-1',
            externalGroupId: 'G-1',
            orgId: 'org-A',
            spaceId: 'space-A',
            groupDisplayNameSnapshot: 'ある会社の相談グループ',
          }),
        )
        // webhookはgroup行を作らない（承認RPCファミリ経由のみ・§3）
        expect(storeMock.findOrCreateActiveGroup).not.toHaveBeenCalled()
        expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
        expect(replyMock).toHaveBeenCalledTimes(1)
        const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
        expect(replyArg.messages[0].text).toContain('QW3R')
      })

      it('web_approvalの有効コード(GC-プレフィクスなし・26文字本体のみ)でも同様に成立する', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
          id: 'code-1',
          orgId: 'org-A',
          spaceId: 'space-A',
          bindingMode: 'web_approval',
        })
        const body = makeBody([groupTextEvent(CANONICAL)])
        await handleLineWebhook(body, sign(body))

        expect(storeMock.findOrCreatePendingGroupClaim).toHaveBeenCalled()
      })

      it('無効なコード（見つからない）は固定文言reply（存在/理由を推測させない）', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue(null)
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(storeMock.findOrCreatePendingGroupClaim).not.toHaveBeenCalled()
        expect(replyMock).toHaveBeenCalledTimes(1)
        const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
        expect(replyArg.messages[0].text).not.toContain('QW3R')
      })

      it('無効理由(not-found/redeemがrejected)は全て同一バイト列の固定文言（存在/理由を区別させない）', async () => {
        const texts: string[] = []

        // not-found相当（findValidSharedGroupClaimCodeがnull＝webhook層はRPCすら呼ばない）
        storeMock.findValidSharedGroupClaimCode.mockResolvedValueOnce(null)
        const body1 = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body1, sign(body1))
        texts.push((replyMock.mock.calls.at(-1)![0] as { messages: { text: string }[] }).messages[0].text)

        // findValidSharedGroupClaimCode内部でexpired/consumed/他org/他accountは全てnullに畳まれる
        // （store層のテストで検証済み）ため、webhook層としては「null＝固定文言」の1本の応答だけを
        // 確認すれば理由の別が漏れていないことを保証できる。code_only経路のマッチ無効
        // （redeemCodeOnlyClaimがrejected）も同一文言に畳む。
        storeMock.findValidSharedGroupClaimCode.mockResolvedValueOnce({
          id: 'code-2',
          orgId: 'org-B',
          spaceId: 'space-B',
          bindingMode: 'code_only',
        })
        storeMock.redeemCodeOnlyClaim.mockResolvedValueOnce('rejected')
        const body2 = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body2, sign(body2))
        texts.push((replyMock.mock.calls.at(-1)![0] as { messages: { text: string }[] }).messages[0].text)

        expect(new Set(texts).size).toBe(1) // 全て同一バイト列
      })

      describe('binding_mode=code_only（PR3b実装・人の承認なしに即時償還）', () => {
        beforeEach(() => {
          storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
            id: 'code-2',
            orgId: 'org-A',
            spaceId: 'space-A',
            bindingMode: 'code_only',
          })
          groupSummaryMock.mockResolvedValue({ groupName: 'ある店舗のグループ' })
        })

        it('linked: 成功文言でreplyし、rpc_redeem_code_only_claimをhash/account/group/表示名/容量上限で呼び、成立通知をトリガーする', async () => {
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('linked')
          storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 2, maxGroups: 3 })

          const { hashSharedGroupClaimCode } = await import('@/lib/channels/sharedGroupClaim')
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          const result = await handleLineWebhook(body, sign(body))

          expect(result.status).toBe(200)
          // ★容量上限を linkCode.orgId で解決して RPC へ渡す（code_only 経路のハード上限を活性化）。
          expect(storeMock.orgLineGroupCapacity).toHaveBeenCalledWith('org-A')
          expect(storeMock.redeemCodeOnlyClaim).toHaveBeenCalledWith(
            hashSharedGroupClaimCode(CANONICAL),
            'acc-shared-1',
            'G-1',
            'ある店舗のグループ',
            3,
          )
          // web_approval用のclaim登録(pending)は呼ばない（code_onlyは別経路・pendingを経由しない）
          expect(storeMock.findOrCreatePendingGroupClaim).not.toHaveBeenCalled()
          expect(replyMock).toHaveBeenCalledTimes(1)
          const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
          expect(replyArg.messages[0].text).not.toBe('') // 固定invalid文言ではない専用の成功文言
          expect(groupClaimNotifyMock.notifyCodeOnlyGroupLinked).toHaveBeenCalledWith(
            'org-A',
            'space-A',
            'ある店舗のグループ',
          )
        })

        it('容量上限(maxGroups=null=無制限)でも解決値をそのまま渡す（Enterprise非拒否）', async () => {
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('linked')
          storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 99, maxGroups: null })

          const { hashSharedGroupClaimCode } = await import('@/lib/channels/sharedGroupClaim')
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          await handleLineWebhook(body, sign(body))

          expect(storeMock.redeemCodeOnlyClaim).toHaveBeenCalledWith(
            hashSharedGroupClaimCode(CANONICAL),
            'acc-shared-1',
            'G-1',
            'ある店舗のグループ',
            null,
          )
        })

        it('容量上限レース(RPCがrejectedに畳む)は無効コードと同一の固定文言で応答', async () => {
          // 上限-1から並列償還したレース時、RPCが GC402→rejected に畳む（store側で検証済み）。
          // webhook 層はそれを既存の rejected と同一文言に扱う（存在/理由を漏らさない）。
          storeMock.orgLineGroupCapacity.mockResolvedValue({ activeCount: 3, maxGroups: 3 })
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('rejected')
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          await handleLineWebhook(body, sign(body))

          expect(storeMock.orgLineGroupCapacity).toHaveBeenCalledWith('org-A')
          const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
          expect(replyArg.messages[0].text).toBe('コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。')
          expect(groupClaimNotifyMock.notifyCodeOnlyGroupLinked).not.toHaveBeenCalled()
        })

        it('already_linked: 既に登録済み文言でreplyし、成立通知は呼ばない', async () => {
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('already_linked')
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          await handleLineWebhook(body, sign(body))

          expect(replyMock).toHaveBeenCalledTimes(1)
          const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
          expect(replyArg.messages[0].text).toContain('既に登録済み')
          expect(groupClaimNotifyMock.notifyCodeOnlyGroupLinked).not.toHaveBeenCalled()
        })

        it('rejected: 無効コードと同一の固定文言でreplyし、成立通知は呼ばない', async () => {
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('rejected')
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          await handleLineWebhook(body, sign(body))

          expect(replyMock).toHaveBeenCalledTimes(1)
          const replyArg = replyMock.mock.calls[0][0] as { messages: { text: string }[] }
          expect(replyArg.messages[0].text).toBe('コードをお確かめのうえ、もう一度お送りください。ご不明な場合は事務所までご連絡ください。')
          expect(groupClaimNotifyMock.notifyCodeOnlyGroupLinked).not.toHaveBeenCalled()
        })

        it('成立通知が失敗しても紐付け自体は成立させ、webhookは200のまま', async () => {
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('linked')
          groupClaimNotifyMock.notifyCodeOnlyGroupLinked.mockRejectedValue(new Error('mail down'))
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          const result = await handleLineWebhook(body, sign(body))

          expect(result.status).toBe(200)
          expect(replyMock).toHaveBeenCalledTimes(1)
        })

        // Fable §6: disabled = freeze (inaction, no code consumption). 旧仕様(disabled中もredeemする)から反転。
        it('disabled中はredeemしない（コード非消費・凍結=不作為）', async () => {
          storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_DISABLED_ACCOUNT)
          storeMock.redeemCodeOnlyClaim.mockResolvedValue('linked')
          const body = makeBody([groupTextEvent(DISPLAY_FORM)])
          await handleLineWebhook(body, sign(body))

          expect(storeMock.findValidSharedGroupClaimCode).not.toHaveBeenCalled()
          expect(storeMock.redeemCodeOnlyClaim).not.toHaveBeenCalled()
          expect(limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit).not.toHaveBeenCalled()
          expect(replyMock).not.toHaveBeenCalled()
        })
      })

      it('コード形状でない通常発言は紐付け処理を試みない（完全な沈黙・無反応・無保存）', async () => {
        const body = makeBody([groupTextEvent('了解しました')])
        await handleLineWebhook(body, sign(body))

        expect(storeMock.findValidSharedGroupClaimCode).not.toHaveBeenCalled()
        expect(replyMock).not.toHaveBeenCalled()
      })

      it('8文字の顧問先突合コード形状(legacy)はshared_group_claimとして受理しない（沈黙・長さで排他）', async () => {
        const body = makeBody([groupTextEvent('AB2CD3EF')])
        await handleLineWebhook(body, sign(body))

        expect(storeMock.findValidSharedGroupClaimCode).not.toHaveBeenCalled()
        expect(replyMock).not.toHaveBeenCalled()
      })

      // Fable §6: disabled = freeze (inaction, no claims/limbo writes). 旧仕様(disabled中もclaim登録する)から反転。
      it('disabled中はclaim登録しない（台帳不変・凍結=不作為）', async () => {
        storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_DISABLED_ACCOUNT)
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
          id: 'code-1',
          orgId: 'org-A',
          spaceId: 'space-A',
          bindingMode: 'web_approval',
        })
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(storeMock.findValidSharedGroupClaimCode).not.toHaveBeenCalled()
        expect(storeMock.findOrCreatePendingGroupClaim).not.toHaveBeenCalled()
        expect(replyMock).not.toHaveBeenCalled()
      })

      describe('レート制限（設計正本 §7-8）: マッチ無効/コード不一致の投入のみカウントし、上限超過後は無応答化', () => {
      it('無効コードはaccountId/externalGroupId単位でレート制限にカウントされる', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue(null)
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit).toHaveBeenCalledWith(
          'acc-shared-1',
          'G-1',
        )
      })

      it('レート制限が超過(true)を返した場合は完全に無応答化する', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue(null)
        limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit.mockReturnValue(true)
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(replyMock).not.toHaveBeenCalled()
      })

      it('有効な紐付け（web_approval成立）はレート制限にカウントしない', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
          id: 'code-1',
          orgId: 'org-A',
          spaceId: 'space-A',
          bindingMode: 'web_approval',
        })
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit).not.toHaveBeenCalled()
        expect(replyMock).toHaveBeenCalledTimes(1)
      })

      it('code_onlyのlinked/already_linkedもレート制限にカウントしない', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
          id: 'code-2',
          orgId: 'org-A',
          spaceId: 'space-A',
          bindingMode: 'code_only',
        })
        storeMock.redeemCodeOnlyClaim.mockResolvedValue('linked')
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit).not.toHaveBeenCalled()
        expect(replyMock).toHaveBeenCalledTimes(1)
      })

      it('code_onlyのrejectedはレート制限にカウントされる', async () => {
        storeMock.findValidSharedGroupClaimCode.mockResolvedValue({
          id: 'code-2',
          orgId: 'org-A',
          spaceId: 'space-A',
          bindingMode: 'code_only',
        })
        storeMock.redeemCodeOnlyClaim.mockResolvedValue('rejected')
        const body = makeBody([groupTextEvent(DISPLAY_FORM)])
        await handleLineWebhook(body, sign(body))

        expect(limboRateLimitMock.registerInvalidClaimAttemptAndCheckLimit).toHaveBeenCalledWith(
          'acc-shared-1',
          'G-1',
        )
      })
    })
    })
  })

  describe('承認済み(active)グループ: 以降はgroup.orgId起点でorg専用botと同じ経路', () => {
    beforeEach(() => {
      storeMock.findActiveGroup.mockResolvedValue(PLATFORM_GROUP)
    })

    it('通常発言はgroup.orgId/group.spaceIdで記録される（account.orgId=nullではない）', async () => {
      const body = makeBody([groupTextEvent('本日の作業完了しました')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-A', spaceId: 'space-A', groupId: 'group-shared-1' }),
      )
    })

    // Fable §6: 凍結対象は「新規テナント確立」の経路のみ。紐付け済み(active世代)groupのinbound記録は
    // account.status='disabled'であっても従来どおり継続する（processPlatformLimboGroupMessageは通らない）。
    it('紐付け済み(active世代)groupのinboundはdisabled中でも記録が継続する（凍結対象は新規limboのみ）', async () => {
      storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_DISABLED_ACCOUNT)
      const body = makeBody([groupTextEvent('本日の作業完了しました')])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-A', spaceId: 'space-A', groupId: 'group-shared-1' }),
      )
    })

    it('発言者identityはgroup.orgIdで検索する', async () => {
      const body = makeBody([groupTextEvent('お疲れさまです', { source: { type: 'group', groupId: 'G-1', userId: 'U-member' } })])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.findIdentityIdsByExternalUserIds).toHaveBeenCalledWith('org-A', 'space-A', [
        'U-member',
      ])
    })

    it('digest_done postbackはgroup.orgIdで記録・消し込みできる', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'ダミー',
        status: 'open',
        groupId: 'group-shared-1',
        orgId: 'org-A',
        accountId: 'acc-shared-1',
      })
      storeMock.findGroupById.mockResolvedValue(PLATFORM_GROUP)
      storeMock.markDigestTaskDoneAtomic.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', title: 'ダミー' })

      const body = makeBody([
        postbackEvent('action=digest_done&task=11111111-1111-4111-8111-111111111111', {
          source: { type: 'group', groupId: 'G-1', userId: 'U-1' },
        }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markDigestTaskDoneAtomic).toHaveBeenCalledWith(
        '11111111-1111-4111-8111-111111111111',
        'postback',
        'U-1',
      )
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-A', groupId: 'group-shared-1' }),
      )
    })

    it('旧Flex×org-A→org-B再紐付け後: 同一物理グループGが新世代(org-B)へ再紐付けされた後の旧Flex(org-Aのtask)は0行', async () => {
      // 物理グループGの現active世代は再紐付け後の新世代(group-shared-2/org-B)。
      // 旧task(group-shared-1/org-A)はもう現active世代ではない = 配達済み旧Flexの再現。
      const RELINKED_GROUP = {
        ...PLATFORM_GROUP,
        id: 'group-shared-2',
        orgId: 'org-B',
        spaceId: 'space-B',
      }
      storeMock.findActiveGroup.mockResolvedValue(RELINKED_GROUP)
      storeMock.findDigestTaskForVerification.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'A社の旧タスク',
        status: 'open',
        groupId: 'group-shared-1', // 旧世代
        orgId: 'org-A',
        accountId: 'acc-shared-1',
      })
      storeMock.markDigestTaskDoneAtomic.mockResolvedValue({
        id: '11111111-1111-4111-8111-111111111111',
        title: 'A社の旧タスク',
      })

      const body = makeBody([
        postbackEvent('action=digest_done&task=11111111-1111-4111-8111-111111111111', {
          source: { type: 'group', groupId: 'G-1', userId: 'U-1' },
        }),
      ])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      // A社の旧taskを完了させない・B社に何も書かない・A社タスク名をB社グループへ返信しない
      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })

    it('leave: 記録はgroup.orgId起点で行われる', async () => {
      const body = makeBody([leaveEvent()])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-A', spaceId: 'space-A', groupId: 'group-shared-1' }),
      )
    })
  })
})

describe('グループ送信メッセージ処理: group.account_idの不変条件（event account_id == group.account_id）', () => {
  it('digest_done postbackの検証はaccount.id一致＋グループ由来一致で行い、account.orgIdに依存しない', async () => {
    storeMock.findLineAccountByDestination.mockResolvedValue(PLATFORM_ACCOUNT)
    storeMock.findDigestTaskForVerification.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'ダミー',
      status: 'open',
      groupId: 'group-shared-1',
      orgId: 'org-A',
      accountId: 'acc-shared-1',
    })
    storeMock.findGroupById.mockResolvedValue(PLATFORM_GROUP)
    storeMock.findActiveGroup.mockResolvedValue(PLATFORM_GROUP)
    storeMock.markDigestTaskDoneAtomic.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111', title: 'ダミー' })

    const body = makeBody([
      postbackEvent('action=digest_done&task=11111111-1111-4111-8111-111111111111', {
        source: { type: 'group', groupId: 'G-1', userId: 'U-1' },
      }),
    ])
    const result = await handleLineWebhook(body, sign(body))

    expect(result.status).toBe(200)
    expect(storeMock.markDigestTaskDoneAtomic).toHaveBeenCalled()
  })

  it('event.groupId無しのdigest postbackはfail-closedで拒否される（org境界を検証できないため。mutation・保存とも0行）', async () => {
    storeMock.findDigestTaskForVerification.mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      title: 'ダミー',
      status: 'open',
      groupId: 'group-1',
      orgId: 'org-1',
      accountId: 'acc-1',
    })
    const body = makeBody([
      postbackEvent('action=digest_done&task=11111111-1111-4111-8111-111111111111', {
        source: { type: 'user', userId: 'U-1' },
      }),
    ])
    await handleLineWebhook(body, sign(body))

    expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
    expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
  })
})
