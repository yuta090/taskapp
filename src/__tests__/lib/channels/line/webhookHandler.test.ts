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
  orgId: 'org-1',
  displayName: '山田会計事務所',
  channelSecret: CHANNEL_SECRET,
  accessToken: 'token-xyz',
  status: 'active' as const,
}
const DISABLED_ACCOUNT = { ...ACCOUNT, status: 'disabled' as const }

const GROUP = {
  id: 'group-1',
  orgId: 'org-1',
  spaceId: null as string | null,
  accountId: 'acc-1',
  externalGroupId: 'G-1',
  displayName: null,
  status: 'active' as const,
  digestEnabled: true,
  lastExtractedMessageCreatedAt: null,
}

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
}
vi.mock('@/lib/channels/store', () => storeMock)

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
vi.mock('@/lib/channels/line/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/channels/line/client')>()
  return {
    ...actual,
    pushLineMessage: (...args: unknown[]) => pushMock(...args),
    fetchLineMessageContent: (...args: unknown[]) => fetchContentMock(...args),
    replyLineMessage: (...args: unknown[]) => replyMock(...args),
    leaveRoom: (...args: unknown[]) => leaveRoomMock(...args),
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
  storeMock.findLineAccountByDestination.mockResolvedValue(ACCOUNT)
  storeMock.findActiveLineIdentities.mockResolvedValue([])
  storeMock.insertChannelMessage.mockResolvedValue({ id: 'row-1' })
  storeMock.findValidLinkCode.mockResolvedValue(null)
  storeMock.findOrCreateActiveGroup.mockResolvedValue(GROUP)
  storeMock.findActiveGroup.mockResolvedValue(GROUP)
  storeMock.findGroupById.mockResolvedValue(GROUP)
  storeMock.linkGroupToSpaceAtomic.mockResolvedValue(true)
  storeMock.markGroupLeft.mockResolvedValue(undefined)
  pushMock.mockResolvedValue(undefined)
  replyMock.mockResolvedValue(undefined)
  leaveRoomMock.mockResolvedValue(undefined)
  sinksStoreMock.disableStaleGroupSinks.mockResolvedValue([])
  sinksNotifyMock.notifySinkDisabledForRelink.mockResolvedValue(undefined)
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

    it('1対1 identityを持つ人のグループ発言にidentity由来のspace_idは付かない', async () => {
      storeMock.findActiveLineIdentities.mockResolvedValue([{ id: 'ident-1', spaceId: 'space-OTHER' }])
      const body = makeBody([
        groupTextEvent('お疲れさまです', { source: { type: 'group', groupId: 'G-1', userId: 'U-member' } }),
      ])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: null, identityId: 'ident-1' }),
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

    it('「完了2」返信: openかつdigest_number=2を原子更新しreplyで確認', async () => {
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
      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          replyToken: 'rt-g1',
          messages: [expect.objectContaining({ text: expect.stringContaining('酒屋へ発注') })],
        }),
      )
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

    it('検証OK → 原子更新 → replyで完了を通知 → 消し込み操作をchannel_messagesに証跡として記録', async () => {
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      const result = await handleLineWebhook(body, sign(body))

      expect(result.status).toBe(200)
      expect(storeMock.markDigestTaskDoneAtomic).toHaveBeenCalledWith(TASK_ID, 'postback', 'U-client-1')
      expect(replyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          replyToken: 'rt-postback',
          messages: [expect.objectContaining({ text: expect.stringContaining('酒屋へ発注') })],
        }),
      )
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

    it('他org/他アカウントのタスクへのpostbackは拒否される（証跡にはresult=rejectedで記録・replyなし）', async () => {
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
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ result: 'rejected' }) }),
      )
    })

    it('他グループのタスク（同accountだが別グループ）へのpostbackは拒否される', async () => {
      storeMock.findGroupById.mockResolvedValue({ ...GROUP, id: 'group-1', externalGroupId: 'G-OTHER' })
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.markDigestTaskDoneAtomic).not.toHaveBeenCalled()
    })

    it('存在しないtaskIdへのpostbackはrejectedとして記録される', async () => {
      storeMock.findDigestTaskForVerification.mockResolvedValue(null)
      const body = makeBody([postbackEvent(`action=digest_done&task=${TASK_ID}`)])
      await handleLineWebhook(body, sign(body))

      expect(replyMock).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ result: 'rejected' }) }),
      )
    })

    it('不明なpostback形式は無視する（記録もしない）', async () => {
      const body = makeBody([postbackEvent('action=unknown')])
      await handleLineWebhook(body, sign(body))

      expect(storeMock.findDigestTaskForVerification).not.toHaveBeenCalled()
      expect(storeMock.insertChannelMessage).not.toHaveBeenCalled()
    })
  })
})
